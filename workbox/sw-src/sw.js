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
  syncDepsQueueMsg,
} from '../src/constants.mjs'

console.log('SW Startup!')

const depsQueue = new Queue('obs-dependant-queue', {
  maxRetentionTime: 365 * 24 * 60, // if it doesn't succeed after year, let it die
  async onSync() {
    const boundFn = onSyncWithPerItemCallback.bind(this)
    await boundFn(
      async resp => {
        const isProjectLinkingResp = resp.url.endsWith('/project_observations')
        // FIXME should we also check resp.ok?
        if (!isProjectLinkingResp) {
          return
        }
        console.debug('resp IS a project linkage one')
        sendMessageToAllClients(refreshObsMsg)
      },
      async resp => {
        // FIXME implement client error cb
        throw new Error('FIXME implement me')
        // do we need to rollback the obs?
      },
    )
  },
})

// We don't need to register a route for /observations, etc because:
//  1. if we have a SW, we're using the synthetic bundle endpoint
//  2. fetch calls made *from* the SW don't hit the routes we configure
const obsQueue = new Queue('obs-queue', {
  maxRetentionTime: 365 * 24 * 60, // if it doesn't succeed after year, let it die
  async onSync() {
    const boundFn = onSyncWithPerItemCallback.bind(this)
    await boundFn(
      async resp => {
        let obsId = '(not sure)'
        try {
          const obs = await resp.json()
          obsId = obs.id
          await onObsPostSuccess(obs)
        } catch (err) {
          // an error happened while *queuing*. Errors from processing the queue
          // will not be caught here!
          // FIXME an error that happens while trying to call onObsPostSuccess
          // (ie. this try block) will mean that we never queue up the deps for a
          // successful obs. Might need extra logic to scan obs on the remote and
          // check for pending deps, then trigger the queuing?
          console.warn(
            `Failed to queue dependents of obsId=${obsId}. This is bad.` +
              ` We do not know which, if any, deps were queued. Retrying probably` +
              ` won't help either as the error is not network related.`,
            err,
          )
          throw err
        }
      },
      async resp => {
        // FIXME implement client error cb
        throw new Error('FIXME implement me')
        // maybe notify client page that this failed?
      },
    )
  },
})

async function onSyncWithPerItemCallback(successCb, clientErrorCb) {
  let entry
  while ((entry = await this.shiftRequest())) {
    let resp
    try {
      resp = await fetch(entry.request.clone())
      console.log(
        `Request for '${entry.request.url}' ` +
          `has been replayed in queue '${this._name}'`,
      )
      const statusCode = resp.status
      const is4xxStatusCode = statusCode >= 400 && statusCode < 500
      if (is4xxStatusCode) {
        console.log(
          `Response (status=${statusCode}) for '${resp.url}'` +
            ` indicates client error. Calling cleanup callback, then ` +
            `continuing processing the queue`,
        )
        await clientErrorCb(resp)
        continue // other queued reqs may succeed
      }
      const isServerError = statusCode >= 500 && statusCode < 600
      if (isServerError) {
        console.log(
          `Response (status=${statusCode}) for '${resp.url}'` +
            ` indicates server error for '${entry.request.url}'. ` +
            `Putting request back in queue '${this._name}'; will retry later.`,
          err,
        )
        await this.unshiftRequest(entry)
        // FIXME probably need to throw here to stop an immediate retry
        return // other queued reqs probably won't succeed (right now), wait for next sync
      }
    } catch (err) {
      // "Failed to fetch" lands us here. It could be a network error or a
      // non-CORS response.
      await this.unshiftRequest(entry)
      console.log(
        `Request for '${entry.request.url}' ` +
          `failed to replay, putting it back in queue '${this._name}'. Error was:`,
        err,
      )
      // Note: we *need* to throw here to stop an immediate retry on sync.
      // Workbox does this for good reason: it needs to process items that were
      // added to the queue during the sync. It's a bit messy because the error
      // ends up as an "Uncaught (in promise)" but that's due to
      // https://github.com/GoogleChrome/workbox/blob/v4.3.1/packages/workbox-background-sync/Queue.mjs#L331.
      // Maybe should that just be a console.error/warn?
      throw (() => {
        const result = new Error(
          `Failed to replay queue '${this._name}', due to: ` + err.message,
        )
        result.name = 'QueueReplayError'
        return result
      })()
    }
    try {
      await successCb(resp)
    } catch (err) {
      console.error('Failed during callback for a queue item, re-throwing...')
      // FIXME probably shouldn't throw here. Not sure what to do. Certainly
      // log the error and perhaps continue processing the queue
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
    // FIXME this is probably an error. We *always* have deps!
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
  console.debug(
    'Cleaning up after ourselves. All requests have been generated' +
      ' and queued up so we do not need this data anymore',
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
    case syncDepsQueueMsg:
      if (depsQueue._syncInProgress) {
        // FIXME doesn't seem to work. The flag doesn't seem reliable
        console.log('depsQueue already seems to be doing a sync')
        return
      }
      console.log('triggering deps queue processing at request of client')
      depsQueue._onSync().catch(err => {
        console.warn('Manually triggered depsQueue sync has failed', err)
      })
      return
    case syncObsQueueMsg:
      if (obsQueue._syncInProgress) {
        // FIXME doesn't seem to work. The flag doesn't seem reliable
        console.log('obsQueue already seems to be doing a sync')
        return
      }
      console.log('triggering obs queue processing at request of client')
      obsQueue._onSync().catch(err => {
        console.warn('Manually triggered obsQueue sync has failed', err)
      })
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
