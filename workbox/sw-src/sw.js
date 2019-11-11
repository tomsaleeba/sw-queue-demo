import { Plugin as BackgroundSyncPlugin } from 'workbox-background-sync/Plugin.mjs'
import { Queue } from 'workbox-background-sync/Queue.mjs'
import { registerRoute } from 'workbox-routing/registerRoute.mjs'
import { NetworkOnly } from 'workbox-strategies/NetworkOnly.mjs'
import { endpointPrefix } from '../src/constants.mjs'
import Dexie from 'dexie'

console.log('SW Startup!')

const db = new Dexie('WowSwDb')

db.version(1).stores({
  deps: `uniqueId`, // requests dependent on an obs resp
})

// FIXME it seems we can't use the one queue for both the plugin AND our own use. Should we have a separate queue for our retries? It would let us have separate logic for those if we needed.
// We could have the queue we push everything to from the synth endpoint. It's easy to fire all that off. Then we have a queue for the obs endpoint so we can hook those responses and the photos and obsfields endpoints get their own vanilla queues.
const queue = new Queue('obs-dependant-queue')

registerRoute(
  `${endpointPrefix}/observations`,
  new NetworkOnly({
    plugins: [
      new BackgroundSyncPlugin('obs-queue', {
        maxRetentionTime: 365 * 24 * 60, // if it doesn't succeed after year, let it die
        async onSync() {
          let entry
          while ((entry = await this.shiftRequest())) {
            try {
              const resp = await fetch(entry.request.clone())
              console.log(
                `Request for '${entry.request.url}' ` +
                  `has been replayed in queue '${this._name}'`,
              )
              const obs = await resp.body()
              await onObsPostSuccess(obs, null, null, this)
              // FIXME send a msg to refresh to UI? need onObsPostSuccess to be properly await-able too
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
          }
          // FIXME hook end of queue processing to notify clients to refresh
        },
      }),
    ],
  }),
  'POST',
)

function onObsPostSuccess(obsResp, photos, obsFields, queue) {
  const obsId = obsResp.id
  console.debug(`Running post-success block for obs ID=${obsId}`)
  // TODO should we always pull photos and obsFields from storage?
  // TODO should we always put reqs onto the queue?
  const photosToProcess = photos || getPhotosFor(obsResp.uniqueId) || []
  const obsFieldsToProcess =
    obsFields || getObsFieldsFor(obsResp.uniqueId) || []
  if (queue) {
    // TODO unshift() reqs onto queue
    return
  }
  for (const curr of photosToProcess) {
    const fd = new FormData()
    fd.append('obsId', obsId)
    fd.append('file', curr)
    // FIXME should we await these or push onto queue?
    fetch(endpointPrefix + '/photos', {
      method: 'POST',
      mode: 'cors',
      body: fd,
    })
    // FIXME need to ensure these are retried if they fail
  }
  // TODO process obsFields
}

const handler = async ({ url, event, params }) => {
  console.debug('Service worker processing POSTed bundle')
  const formData = await event.request.formData()
  const obs = JSON.parse(formData.get('obs'))
  // TODO
  //   stash fields and photos (IndexedDB? Is this always available when SW is)
  //   make obs req, then the hook on the resp will take over
  await db.deps.put({
    uniqueId: obs.uniqueId,
    // FIXME get the photos and obsfields
  })
  // TODO should we always put the req onto the queue?
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
      onObsPostSuccess(
        obs,
        formData.getAll('photos'),
        formData.getAll('obsFields'),
      )
      // don't "return from fn" which would make this part of the promise
      // chain, it will be retried separately
      // FIXME should we send msg to refresh to UI? Need to also await onObsPostSuccess
    })
    .catch(err => {
      console.error(
        'Failed to trigger photos and obsFields after obs success',
        err,
      )
      // TODO store dependants so they can be found after the obs req is retried
    })
  return new Response(
    JSON.stringify({
      result: 'queued',
      photoCount: formData.getAll('photos').length,
      // TODO add obsField count
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
