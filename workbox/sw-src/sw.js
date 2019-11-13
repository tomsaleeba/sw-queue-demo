import { Plugin as BackgroundSyncPlugin } from 'workbox-background-sync/Plugin.mjs'
import { Queue } from 'workbox-background-sync/Queue.mjs'
import { registerRoute } from 'workbox-routing/registerRoute.mjs'
import { NetworkOnly } from 'workbox-strategies/NetworkOnly.mjs'
import localForage from 'localforage' // could use idb-keyval instead if we trust all indexeddb implementations will work properly
import {
  endpointPrefix,
  obsFieldName,
  obsFieldsFieldName,
  photosFieldName,
  projectIdFieldName,
  refreshObsMsg,
  syncObsQueueMsg,
  triggerQueueProcessingMsg,
} from '../src/constants.mjs'

console.log('SW Startup!')

const depsQueue = new Queue('obs-dependant-queue', {
  maxRetentionTime: 365 * 24 * 60, // if it doesn't succeed after year, let it die
  async onSync() {
    const boundFn = onSyncWithPerItemCallback.bind(this)
    await boundFn(async resp => {
      const isProjectLinkingResp = resp.url.endsWith('/project_observations')
      // FIXME should we also check resp.ok?
      if (!isProjectLinkingResp) {
        return
      }
      console.debug('resp IS a project linkage one')
      sendMessageToAllClients(refreshObsMsg)
    })
  },
})

// We don't need to register a route for /observations, etc because:
//  1. if we have a SW, we're using the synthetic bundle endpoint
//  2. fetch calls made *from* the SW don't hit the routes we configure
const obsQueue = new Queue('obs-queue', {
  maxRetentionTime: 365 * 24 * 60, // if it doesn't succeed after year, let it die
  async onSync() {
    const boundFn = onSyncWithPerItemCallback.bind(this)
    await boundFn(async resp => {
      let obsId = '(not sure)'
      try {
        const obs = await resp.json()
        obsId = obs.id
        await onObsPostSuccess(obs)
      } catch (err) {
        // FIXME an error that happens while trying to call onObsPostSuccess
        // (ie. this try block) will mean that we never queue up the deps for a
        // successful obs. Might need extra logic to scan obs on the remote and
        // check for pending deps, then trigger the queuing?
        console.warn(
          `Failed processing dependents of obsId=${obsId}. ` +
            `They *should* be retried`,
          err,
        )
        throw err
      }
    })
  },
})

async function onSyncWithPerItemCallback(cb) {
  let entry
  while ((entry = await this.shiftRequest())) {
    let resp
    try {
      resp = await fetch(entry.request.clone())
      console.log(
        `Request for '${entry.request.url}' ` +
          `has been replayed in queue '${this._name}'`,
      )
    } catch (err) {
      console.error(err)
      await this.unshiftRequest(entry)
      console.log(
        `Request for '${entry.request.url}' ` +
          `failed to replay, putting it back in queue '${this._name}'`,
      )
      // FIXME if a 4xx response, we need to do something more. Can we
      // rollback the whole obs? We only need to DELETE the obs and the rest
      // will fall. Will probably need a separate callback for that
      // FIXME throwing this error doesn't seem to be caught and results in
      // the uncaught in promise that we're seeing. Is there another option?
      // Perhaps we should log the error here, then return. The queue can then
      // try again on the next sync
      throw new Error('queue-replay-failed', { name: this._name })
    }
    try {
      await cb(resp)
    } catch (err) {
      console.error('Failed during callback for a queue item, re-throwing...')
      throw err
    }
  }
}

async function onObsPostSuccess(obsResp) {
  // it would be nice to print a warning if there are still items in the queue.
  // For this demo, things can get crazy when this is the case.
  const obsUnqiueId = obsResp.uniqueId
  const obsId = obsResp.id
  console.debug(
    `Running post-success block for obs unique ID=${obsUnqiueId}, ` +
      `which has ID=${obsId}`,
  )
  // We're using localForage in the hope that webkit won't silently eat our
  // blobs. If it does, you need to reserialise them to ArrayBuffers to avoid
  // heartache.
  // https://developers.google.com/web/fundamentals/instant-and-offline/web-storage/indexeddb-best-practices#not_everything_can_be_stored_in_indexeddb_on_all_platforms
  const depsRecord = await localForage.getItem(obsUnqiueId)
  if (!depsRecord) {
    console.warn(`No deps found for obsUnqiueId=${obsUnqiueId}`)
    return
  }
  try {
    for (const curr of depsRecord.photos) {
      const fd = new FormData()
      fd.append('obsId', obsId)
      fd.append('file', curr)
      console.debug('Pushing a photo to the queue')
      await depsQueue.pushRequest({
        request: new Request(endpointPrefix + '/photos', {
          method: 'POST',
          mode: 'cors',
          body: fd,
        }),
      })
    }
    for (const curr of depsRecord.obsFields) {
      console.debug('Pushing an obsField to the queue')
      await depsQueue.pushRequest({
        request: new Request(endpointPrefix + '/obs-fields', {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            field: curr,
            obsId,
          }),
        }),
      })
    }
    console.debug('Pushing project linkage call to the queue')
    await depsQueue.pushRequest({
      request: new Request(endpointPrefix + '/project_observations', {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          obsId,
          projectId: depsRecord.projectId,
        }),
      }),
    })
    // if (!depsQueue._syncInProgress) {
    //   console.debug('depsQueue is not currently processing, giving it a kick')
    //   depsQueue._onSync() // FIXME do we need to catch errors here?
    // }
  } catch (err) {
    // Note: error related to queue processing, which if we're connected to the
    // network will be triggered by pushing items, won't be caught here.
    console.debug('caught error while populating queue, rethrowing...')
    throw err
  }
  // FIXME we currently have no way to know if the requests succeed but aren't
  // ok (503, 400, etc). To achieve this, we need to roll our own replayer and
  // use that on our deps queue. Maybe it's ok without this, as we don't expect
  // non-200 responses. But they might happen and we need to know!
  console.debug(
    'Cleaning up after ourselves. All requests have been generated so' +
      ' we do not need this data anymore',
  )
  await localForage.removeItem(obsUnqiueId)
}

const handler = async ({ url, event, params }) => {
  console.debug('Service worker processing POSTed bundle')
  const formData = await event.request.formData()
  const obs = JSON.parse(formData.get('obs'))
  const photos = formData.getAll(photosFieldName)
  const obsFields = formData.getAll(obsFieldsFieldName)
  const projectId = formData.get(projectIdFieldName)
  await localForage.setItem(obs.uniqueId, {
    uniqueId: obs.uniqueId,
    photos,
    obsFields,
    projectId,
  })
  try {
    // FIXME seeing "Uncaught (in promise) Error: queue-replay-failed" when the
    // queue processing gets "Failed to fetch". This it's Dexie getting in the
    // way (see Readme TODOs). We don't want to see uncaught rejections!
    await obsQueue.pushRequest({
      request: new Request(endpointPrefix + '/observations', {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(obs),
      }),
    })
    // TODO the real sync doesn't seem to check before running so you can get
    // two threads of processing running at once, messy. If the queue has seen
    // an error, it won't start processing when we push a new request so that's
    // when this would be good.
    // if (!obsQueue._syncInProgress) {
    //   console.debug('obsQueue is not currently processing, giving it a kick')
    //   obsQueue._onSync() // FIXME do we need to catch errors here?
    // }
  } catch (err) {
    // FIXME not sure what to do here? We should probably re-throw so the
    // client knows we failed. Is it important for the client to distinguish
    // between "no SW" and "there is a SW but it failed"?
    console.error('Failed to push obs req onto queue', err)
  }
  return new Response(
    JSON.stringify({
      result: 'queued',
      photoCount: photos.length,
      obsFieldCount: obsFields.length,
      projectId,
    }),
  )
}

registerRoute('http://local.service-worker/queue/obs-bundle', handler, 'POST')

// Install Service Worker
self.addEventListener('install', function(event) {
  console.log('installed!')
})

// Service Worker Active
self.addEventListener('activate', function(event) {
  console.log('activated!')
})

self.addEventListener('message', function(event) {
  switch (event.data) {
    case triggerQueueProcessingMsg:
      if (depsQueue._syncInProgress) {
        // FIXME doesn't seem to work. The flag doesn't seem reliable
        console.log('depsQueue already seems to be doing a sync')
        return
      }
      console.log('triggering deps queue processing at request of client')
      depsQueue._onSync()
      // FIXME do we need to catch errors?
      return
    case syncObsQueueMsg:
      if (obsQueue._syncInProgress) {
        // FIXME doesn't seem to work. The flag doesn't seem reliable
        console.log('obsQueue already seems to be doing a sync')
        return
      }
      console.log('triggering obs queue processing at request of client')
      obsQueue._onSync()
      // FIXME do we need to catch errors?
      return
    default:
      console.log('SW received message: ' + event.data)
      event.ports[0].postMessage('SW says "Hello back!"')
      return
  }
})

function sendMessageToClient(client, msg) {
  return new Promise(function(resolve, reject) {
    const msgChan = new MessageChannel()
    msgChan.port1.onmessage = function(event) {
      if (event.data.error) {
        return reject(event.data.error)
      }
      return resolve(event.data)
    }
    client.postMessage(msg, [msgChan.port2])
  })
}

function sendMessageToAllClients(msg) {
  clients.matchAll().then(clients => {
    clients.forEach(client => {
      sendMessageToClient(client, msg).then(m =>
        console.log('SW received message: ' + m),
      )
    })
  })
}
