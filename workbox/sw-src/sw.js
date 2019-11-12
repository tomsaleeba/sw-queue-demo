import { Plugin as BackgroundSyncPlugin } from 'workbox-background-sync/Plugin.mjs'
import { Queue } from 'workbox-background-sync/Queue.mjs'
import { registerRoute } from 'workbox-routing/registerRoute.mjs'
import { NetworkOnly } from 'workbox-strategies/NetworkOnly.mjs'
import {
  endpointPrefix,
  obsFieldName,
  obsFieldsFieldName,
  photosFieldName,
  triggerQueueProcessingMsg,
} from '../src/constants.mjs'
import Dexie from 'dexie'

console.log('SW Startup!')

const db = new Dexie('WowSwDb')

db.version(1).stores({
  deps: `uniqueId`, // requests dependent on an obs resp
})

// FIXME it seems we can't use the one queue for both the plugin AND our own use. Should we have a separate queue for our retries? It would let us have separate logic for those if we needed.
// We could have the queue we push everything to from the synth endpoint. It's easy to fire all that off. Then we have a queue for the obs endpoint so we can hook those responses and the photos and obsfields endpoints get their own vanilla queues.
const depsQueue = new Queue('obs-dependant-queue')

registerRoute(
  `${endpointPrefix}/observations`,
  new NetworkOnly({
    plugins: [
      new BackgroundSyncPlugin('obs-queue', {
        maxRetentionTime: 365 * 24 * 60, // if it doesn't succeed after year, let it die
        async onSync() {
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
              // will fall
              throw new Error('queue-replay-failed', { name: this._name })
            }
            let obsId = '(not sure)'
            try {
              if (!resp) {
                // FIXME assuming req failed, should we halt or keep processing queue?
                continue
              }
              const obs = await resp.body()
              obsId = obs.id
              await onObsPostSuccess(obs)
              // FIXME send a msg to refresh to UI? Or wait until all are processed?
            } catch (err) {
              console.warn(
                `Failed processing dependents of obsId=${obsId}. ` +
                  `They *should* be retried`,
                err,
              )
            }
          }
          // FIXME hook end of queue processing to notify clients to refresh
        },
      }),
    ],
  }),
  'POST',
)

async function onObsPostSuccess(obsResp) {
  // it would be nice to print a warning if there are still items in the queue.
  // For this demo, things can get crazy when this is the case.
  const obsUnqiueId = obsResp.uniqueId
  const obsId = obsResp.id
  console.debug(
    `Running post-success block for obs unique ID=${obsUnqiueId}, ` +
      `which has ID=${obsId}`,
  )
  const depsRecord = await db.deps.get(obsUnqiueId)
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
  await db.deps.delete(obsUnqiueId)
}

const handler = async ({ url, event, params }) => {
  console.debug('Service worker processing POSTed bundle')
  const formData = await event.request.formData()
  const obs = JSON.parse(formData.get('obs'))
  // TODO
  //   stash fields and photos (IndexedDB? Is this always available when SW is)
  //   make obs req, then the hook on the resp will take over
  const photos = formData.getAll(photosFieldName)
  const obsFields = formData.getAll(obsFieldsFieldName)
  await db.deps.put({
    uniqueId: obs.uniqueId,
    photos,
    obsFields,
  })
  fetch(endpointPrefix + '/observations', {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(obs),
  })
    .then(resp => {
      if (resp.ok) {
        return resp.json()
      }
      // TODO should we craft an error-ish object to pass?
      return Promise.reject(resp)
    })
    .then(obs => {
      onObsPostSuccess(obs)
        .then(() => {
          console.debug(
            `Finished post-obs processing without error for obsId=${obs.id}`,
          )
          // FIXME should we send msg to refresh to UI?
        })
        .catch(err => {
          console.warn(
            `Failed processing dependents of obsId=${obs.id}. ` +
              `They *should* be retried`,
            err,
          )
        })
    })
    .catch(err => {
      // TODO should this just be a warning as it will be retried?
      console.error(
        'Failed to POST obs. It should be retried automatically',
        err,
      )
    })
  return new Response(
    JSON.stringify({
      result: 'queued',
      photoCount: photos.length,
      obsFieldCount: obsFields.length,
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
  if (event.data === triggerQueueProcessingMsg) {
    console.log('triggering deps queue processing at request of client')
    depsQueue.replayRequests()
    // FIXME do we need to catch errors?
    return
  }
  console.log('SW received message: ' + event.data)
  event.ports[0].postMessage('SW says "Hello back!"')
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
    client.postMessage('SW says: "' + msg + '"', [msgChan.port2])
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
