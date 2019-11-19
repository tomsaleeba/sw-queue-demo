import Vue from 'vue'
import App from './App.vue'

Vue.config.productionTip = false

new Vue({
  render: h => h(App),
}).$mount('#app')

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/service-worker.js')
    .then(function(reg) {
      console.log('SW registration succeeded. Scope is ' + reg.scope)
    })
    .catch(function(err) {
      console.error('SW registration failed with error ' + err)
    })
}
