<template>
  <div id="app">
    <div>
      Service worker support = {{ swStatus }}
      <button @click="refreshSwStatus">Refresh</button>
      <button @click="killSw">Kill SW</button>
      (Note: reload the page to get the SW running again)
    </div>
    <div>
      <button @click="sendMessageToSw">Send msg to SW</button>
      (Note: look in the console)
    </div>
    <div>
      <button @click="doCreateObs">Create observation</button>
    </div>
    <p>Status = {{ theStatus }}</p>
    <h1>Observations</h1>
    <div>
      <button @click="refreshObs">Refresh list</button>
    </div>
    <ul class="obs-list">
      <li v-for="curr of obsList" :key="curr.id" class="obs-item">
        <div>ID={{ curr.id }}</div>
        <div>uniqueID={{ curr.uniqueId }}</div>
        <div>{{ curr.photos.length }} photos</div>
      </li>
      <li v-if="!obsList.length">(empty)</li>
    </ul>
  </div>
</template>

<script>
import { endpointPrefix } from './constants.mjs'

const someJpg = new Blob(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]), {
  type: 'image/jpeg',
})

export default {
  name: 'app',
  data() {
    return {
      theStatus: '(nothing yet)',
      swStatus: '(not checked)',
      obsList: [],
    }
  },
  mounted() {
    this.refreshSwStatus()
  },
  methods: {
    sendMessageToSw(msg) {
      return new Promise(function(resolve, reject) {
        const msgChan = new MessageChannel()
        msgChan.port1.onmessage = function(event) {
          if (event.data.error) {
            return reject(event.data.error)
          }
          return resolve(event.data)
        }
        const controller = navigator.serviceWorker.controller
        if (!controller) {
          return reject(
            'No sw reference available. Either there is no active ' +
              'sw or you did a force refresh (shift + refresh)',
          )
        }
        controller.postMessage('Client 1 says "' + msg + '"', [msgChan.port2])
      })
    },
    async doCreateObs() {
      console.log('creating obs...')
      this.theStatus = 'processing...'
      const obs = {
        uniqueId: btoa(Date.now()),
        foo: 'bar',
      }
      const photo1 = {
        file: someJpg,
      }
      const photo2 = {
        file: someJpg,
      }
      const isNoSwSupport = !(
        'serviceWorker' in navigator && navigator.serviceWorker.controller
      )
      if (isNoSwSupport) {
        console.debug('No SW support, doing it all ourselves')
        try {
          const resp = await this.doJsonPost('observations', obs)
          const obsId = (await resp.json()).id
          const formData1 = new FormData()
          formData1.append('file', photo1.file)
          formData1.append('obsId', obsId)
          await this.doFormPost('photos', formData1)
          const formData2 = new FormData()
          formData2.append('file', photo2.file)
          formData2.append('obsId', obsId)
          await this.doFormPost('photos', formData2)
          this.theStatus = 'finished'
        } catch (err) {
          console.error('Failed to POST obs record', err)
          this.theStatus = 'error'
        }
        // FIXME need retry logic
        return
      }
      console.debug('We have SW support, POSTing bundle')
      const fd = new FormData()
      fd.append('obs', JSON.stringify(obs))
      fd.append('photos', photo1.file, 'photo1')
      fd.append('photos', photo2.file, 'photo2')
      const resp = await fetch('http://local.service-worker/queue/obs-bundle', {
        method: 'POST',
        body: fd,
      })
      if (resp.ok) {
        console.log(
          'All requests queued for obs',
          JSON.stringify(await resp.json()),
        )
        this.theStatus = 'finished'
        return
      }
      // our SW enqueue code failed
      // FIXME do we fallback to the "no service worker" approach, or retry?
      console.error(resp.statusText)
    },
    async refreshObs() {
      console.debug('refreshing obs list...')
      const resp = await fetch(`${endpointPrefix}/observations`, {
        method: 'GET',
        mode: 'cors',
      })
      this.obsList = await resp.json()
    },
    async _doPost(reqType, body, headers) {
      try {
        const resp = await fetch(`${endpointPrefix}/${reqType}`, {
          method: 'POST',
          mode: 'cors',
          ...headers,
          body,
        })
        return resp
      } catch (err) {
        throw err
      }
    },
    doJsonPost(reqType, body) {
      return this._doPost(reqType, JSON.stringify(body), {
        headers: {
          'Content-Type': 'application/json',
        },
      })
    },
    doFormPost(reqType, body) {
      return this._doPost(reqType, body, {})
    },
    refreshSwStatus() {
      console.debug('Checking SW support')
      if (!('serviceWorker' in navigator)) {
        this.swStatus = 'No. Not supported'
        return
      }
      if (!navigator.serviceWorker.controller) {
        this.swStatus = 'No. Not active'
        return
      }
      this.swStatus = 'Yes'
    },
    async killSw() {
      console.debug('killing service worker')
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        for (const registration of registrations) {
          await registration.unregister()
        }
        window.location.reload()
      }
    },
  },
}
</script>

<style>
#app {
  font-family: 'Avenir', Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}

.obs-list {
  list-style: none;
  max-width: 10em;
  margin: 0 auto;
}

.obs-item {
  font-family: monospace;
  margin-bottom: 1em;
}
</style>
