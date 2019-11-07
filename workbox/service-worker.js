importScripts(
  'https://storage.googleapis.com/workbox-cdn/releases/4.3.1/workbox-sw.js',
)

if (workbox) {
  console.log(`Yay! Workbox is loaded 🎉`)
} else {
  console.log(`Boo! Workbox didn't load 😬`)
}
console.log('SW Startup!')

const bgSyncPlugin = new workbox.backgroundSync.Plugin('myQueueName', {
  maxRetentionTime: 24 * 60, // Retry for max of 24 Hours (specified in minutes)
  async onSync() {
    let entry
    while ((entry = await this.shiftRequest())) {
      try {
        const resp = await fetch(entry.request.clone())
        console.log(
          `Request for '${entry.request.url}' ` +
            `has been replayed in queue '${this._name}'`,
        )
        const isForObs = resp.url.includes('/observations')
        if (!isForObs) {
          continue
        }
        console.debug('hooking response of obs creation')
        const obs = await resp.body()
        await onObsPostSuccess(obs, null, null, this)
      } catch (err) {
        console.error(err)
        await this.unshiftRequest(entry)
        console.log(
          `Request for '${entry.request.url}' ` +
            `failed to replay, putting it back in queue '${this._name}'`,
        )
        // FIXME if a 4xx response, we need to do something more. Can we
        // rollback the whole obs? Probably not
        throw new Error('queue-replay-failed', { name: this._name })
      }
    }
    // FIXME hook end of queue processing to notify clients to refresh
  },
})

// FIXME share this URL as config with client pages
const endpointPrefix = 'http://localhost:3000/v1'

workbox.routing.registerRoute(
  new RegExp(endpointPrefix + '.*'),
  new workbox.strategies.NetworkOnly({
    plugins: [bgSyncPlugin],
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
  // TODO
  //   stash fields and photos (IndexedDB? Is this always available when SW is)
  //   make obs req, then the hook on the resp will take over
  // TODO should we always put the req onto the queue?
  fetch(endpointPrefix + '/observations', {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json',
    },
    body: formData.get('obs'),
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

workbox.routing.registerRoute(
  'http://local.service-worker/queue/obs-bundle',
  handler,
  'POST',
)

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
