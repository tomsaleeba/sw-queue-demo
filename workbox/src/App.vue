<template>
  <div id="app">
    <div>
      <h1>Test cases</h1>
      <ul class="test-case-list">
        <li>No service worker, all reqs succeed on first try = success</li>
        <li>
          No service worker, one or more req fail but succeed on the retry =
          success
        </li>
        <li>
          No service worker, one or more req fail and continue to fail despite
          retries = incomplete upload, should either rollback or wait for
          network to retry (with our code) failures
        </li>
        <li>Service worker, all reqs suceed on first try = success</li>
        <li>
          Service worker, fail to queue obs from bundle = failure, should have
          client fallback to no-sw approach
        </li>
        <li>
          Service worker, one or more req (obs or deps) fail to fetch = success,
          failure will be retried until they succeed
        </li>
        <li>
          Service worker, one or more req (obs or deps) continue fail to fetch
          until they expire on the queue = failure, should have something that
          catches this expiry
        </li>
      </ul>
    </div>
    <p>
      Service worker support = {{ swStatus }}
      <button @click="refreshSwStatus">Refresh</button>
    </p>
    <p>
      <button @click="killSw">Kill SW</button>
      (Note: reload the page to get the SW running again)
    </p>
    <p>
      <button @click="sendHelloMessageToSw">Send msg to SW</button>
      (Note: look in the console)
    </p>
    <p>
      <button @click="triggerObsQueue">Trigger obs queue processing</button>
      (Note: be careful, I think you can cause a race condition by processing
      the queue multiple times concurrently)
    </p>
    <p>
      <button @click="triggerDepsQueue">Trigger deps queue processing</button>
      (Note: be careful, I think you can cause a race condition by processing
      the queue multiple times concurrently)
    </p>
    <p>
      <label>
        <input type="checkbox" v-model="isCreateInvalidObs" />
        Cause a 4xx status code by creating an invalid <strong>obs</strong>
      </label>
    </p>
    <p>
      <label>
        <input type="checkbox" v-model="isCreateInvalidDep" />
        Cause a 4xx status code by creating an invalid
        <strong>obsField record</strong>
      </label>
    </p>
    <p>
      <button @click="doCreateObs">Create observation</button>
    </p>
    <p>Status = {{ theStatus }}</p>
    <h1>Observations ({{ obsList.length }})</h1>
    <div>
      <button @click="refreshObs">Refresh list</button>
    </div>
    <table class="obs-list">
      <thead>
        <tr>
          <th>ID</th>
          <th>uniqueID</th>
          <th>foo</th>
          <th># photos</th>
          <th># obsFields</th>
          <th>Project ID</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="curr of obsList" :key="curr.id" class="obs-item">
          <td>{{ curr.id }}</td>
          <td>{{ curr.uniqueId }}</td>
          <td>{{ curr.foo }}</td>
          <td>{{ curr.photos.length }}</td>
          <td>{{ curr.obsFields.length }}</td>
          <td>{{ curr.project }}</td>
          <td>
            <button @click="doDelete(curr.id)">delete</button>
            <button @click="doObsPut(curr)">update</button>
          </td>
        </tr>
        <tr v-if="!obsList.length">
          <td>(empty)</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script>
import fetch from 'fetch-retry'
import * as constants from './constants.mjs'

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
      isCreateInvalidObs: false,
      isCreateInvalidDep: false,
    }
  },
  mounted() {
    this.refreshSwStatus()
    this.registerForSwMessages()
  },
  methods: {
    registerForSwMessages() {
      if (!('serviceWorker' in navigator)) {
        console.warn('no service worker, cannot register for messages')
        return
      }
      navigator.serviceWorker.addEventListener('message', event => {
        switch (event.data.id) {
          case constants.refreshObsMsg:
            this.refreshObs()
            break
          case constants.failedToUploadObsMsg:
            alert(event.data.msg)
            break
          default:
            console.log('Client received message from SW: ' + event.data)
        }
      })
    },
    sendHelloMessageToSw() {
      this._sendMessageToSw('Client 1 says "Hello from App.vue"')
    },
    _sendMessageToSw(msg) {
      return new Promise(function(resolve, reject) {
        const msgChan = new MessageChannel()
        msgChan.port1.onmessage = function(event) {
          if ((event.data || {}).error) {
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
        controller.postMessage(msg, [msgChan.port2])
      })
    },
    async doCreateObs() {
      console.log('creating obs...')
      this.theStatus = 'processing...'
      const obs = (() => {
        const result = {
          uniqueId: btoa(Date.now()),
          foo: 'bar',
        }
        if (this.isCreateInvalidObs) {
          delete result.foo
        }
        return result
      })()
      const photo1 = {
        file: someJpg,
      }
      const photo2 = {
        file: someJpg,
      }
      const obsField1 = {
        fieldId: 11,
        value: 'yes',
      }
      if (this.isCreateInvalidDep) {
        delete obsField1.value
      }
      const obsField2 = {
        fieldId: 89,
        value: 'sandy',
      }
      const noSwStrategy = async () => {
        console.debug('No SW support, doing it all ourselves')
        try {
          console.debug('POSTing observation')
          const resp = await this.doJsonPost('observations', obs)
          const obsId = (await resp.json()).id
          console.debug('POSTing photo1')
          await (() => {
            const formData = new FormData()
            formData.append('file', photo1.file)
            formData.append('obsId', obsId)
            return this.doFormPost('photos', formData)
          })()
          console.debug('POSTing photo2')
          await (() => {
            const formData = new FormData()
            formData.append('file', photo2.file)
            formData.append('obsId', obsId)
            return this.doFormPost('photos', formData)
          })()
          console.debug('POSTing obsField1')
          await this.doJsonPost('obs-fields', {
            obsId,
            field: obsField1,
          })
          console.debug('POSTing obsField2')
          await this.doJsonPost('obs-fields', {
            obsId,
            field: obsField2,
          })
          console.debug('POSTing project linkage')
          await this.doJsonPost('project_observations', {
            obsId,
            projectId: 123,
          })
          this.theStatus = 'finished'
          this.refreshObs()
        } catch (err) {
          console.error('Failed to POST obs record', err)
          this.theStatus = 'error'
        }
        return
      }
      const isSwSupport = await this.isSwAlive()
      if (!isSwSupport) {
        await noSwStrategy()
        return
      }
      try {
        console.debug('We have SW support, POSTing bundle')
        const fd = new FormData()
        fd.append(constants.obsFieldName, JSON.stringify(obs))
        fd.append(constants.photosFieldName, photo1.file, 'photo1')
        fd.append(constants.photosFieldName, photo2.file, 'photo2')
        fd.append(constants.obsFieldsFieldName, JSON.stringify(obsField1))
        fd.append(constants.obsFieldsFieldName, JSON.stringify(obsField2))
        fd.append(constants.projectIdFieldName, JSON.stringify(1234))
        const resp = await fetch(constants.obsBundleEndpoint, {
          method: 'POST',
          body: fd,
          retries: 0,
          headers: {
            Authorization: 'Bearer somekeyblahblah',
          },
        })
        if (resp.ok) {
          console.log(
            'All requests queued for obs',
            JSON.stringify(await resp.json()),
          )
          this.theStatus = 'finished (using SW)'
          return
        }
        await noSwStrategy()
        this.theStatus = 'finished (without SW)'
        return
      } catch (err) {
        console.warn(
          'Error while trying to POST bundle, falling back to no-SW strategy',
          err,
        )
        try {
          await noSwStrategy()
          this.theStatus = 'finished (without SW)'
        } catch (err2) {
          console.error(
            'failed to perform the backup plan: the no SW strategy',
            err2,
          )
          this.theStatus = 'failed'
        }
      }
    },
    async isSwAlive() {
      try {
        const resp = await fetch(constants.areYouActiveEndpoint, {
          retries: 0,
        })
        return resp.ok // if we get a response, it should be ok
      } catch (err) {
        return false
      }
    },
    async refreshObs() {
      console.debug('refreshing obs list...')
      const resp = await fetch(`${constants.endpointPrefix}/observations`, {
        method: 'GET',
        mode: 'cors',
      })
      this.obsList = await resp.json()
    },
    async _doPost(reqType, body, headers) {
      try {
        const resp = await fetch(`${constants.endpointPrefix}/${reqType}`, {
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
    async doJsonPost(reqType, body) {
      const resp = await this._doPost(reqType, JSON.stringify(body), {
        headers: {
          'Content-Type': 'application/json',
        },
      })
      if (!resp.ok) {
        throw new Error(`Req for ${reqType} was not OK`)
      }
      return resp
    },
    async doFormPost(reqType, body) {
      const resp = await this._doPost(reqType, body, {})
      if (!resp.ok) {
        throw new Error(`Req for ${reqType} was not OK`)
      }
      return resp
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
    triggerDepsQueue() {
      this._sendMessageToSw(constants.syncDepsQueueMsg)
    },
    triggerObsQueue() {
      this._sendMessageToSw(constants.syncObsQueueMsg).then(() => {
        console.debug('obs-sync trigger is complete')
      })
    },
    async doDelete(obsId) {
      try {
        const resp = await fetch(
          `${constants.endpointPrefix}/observations/${obsId}`,
          {
            method: 'DELETE',
            mode: 'cors',
          },
        )
        if (!resp.ok) {
          throw new Error(
            'Resp from deleting obs was not ok, status=' + resp.status,
          )
        }
        await this.refreshObs()
      } catch (err) {
        console.error(`Failed to delete observation with obsId=${obsId}`, err)
      }
    },
    async doObsPut(record) {
      try {
        const updatedRecord = {
          // just pretend we changed something
          obsId: record.id,
          uniqueId: record.uniqueId,
        }
        const fd = new FormData()
        fd.append(constants.obsFieldName, JSON.stringify(updatedRecord))
        // we would attach new photos and obsFields, as well as deleted of both too
        const resp = await fetch(
          'http://local.service-worker/queue/obs-bundle',
          {
            method: 'PUT',
            mode: 'cors',
            body: fd,
          },
        )
        if (!resp.ok) {
          throw new Error(
            'Resp from updating obs using sw, was not ok, status=' +
              resp.status,
          )
        }
        return
      } catch (err) {
        console.warn(
          `Failed to update observation with obsId=${obsId}` +
            ` using service worker, falling back to doing the call directly`,
          err,
        )
      }
      try {
        const resp = await fetch(
          `${constants.endpointPrefix}/observations/${obsId}`,
          {
            method: 'PUT',
            mode: 'cors',
            headers: {
              'Content-type': 'application/json',
            },
            body: JSON.stringify(updatedRecord),
          },
        )
        if (!resp.ok) {
          throw new Error(
            'Resp from updating obs directly (no sw) was not ok, status=' +
              resp.status,
          )
        }
        // ...and pretend we also process all the new/delete photos and obsFields
        await this.refreshObs()
      } catch (err) {
        console.error(
          `Failed to update observation with obsId=${obsId}` +
            `. We didn't use the service worker so we have no other options`,
          err,
        )
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
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
}

.obs-item {
  font-family: monospace;
  margin-bottom: 1em;
  white-space: pre;
  text-align: center;
}

.test-case-list {
  text-align: left;
}
</style>
