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
        // FIXME if the request just done was for an obs, now we need to:
        //  pull the ID from the response
        //  unshift the obsfields and photos onto the queue
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

workbox.routing.registerRoute(
  /http:\/\/localhost:3000\/v1\/.*/,
  new workbox.strategies.NetworkOnly({
    plugins: [bgSyncPlugin],
  }),
  'POST',
)

const handler = async ({ url, event, params }) => {
  console.debug('Service worker processing POSTed bundle')
  const body = await event.request.json()
  // TODO
  //   stash fields and photos (IndexedDB? Is this always available when SW is)
  //   make obs req, then the hook on the resp will take over
  return new Response(
    JSON.stringify({ result: 'queued', photoCount: body.photos.length }),
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
