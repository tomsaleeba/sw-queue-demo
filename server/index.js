const express = require('express')
const bodyParser = require('body-parser')
const formidable = require('express-formidable')
const cors = require('cors')
const app = express()
const port = 3000

app.use(cors())

const chanceOfError = parseFloat(process.env.ERROR_CHANCE) || 0.3
console.log(`Chance of synthetic errors (ERROR_CHANCE): ${chanceOfError}`)
const fakeSleepMs = parseInt(process.env.FAKE_SLEEP_MS) || 195
console.log(`FAKE_SLEEP_MS: ${fakeSleepMs}`)

const dataStore = {}

app.get('/v1/observations', bodyParser.json(), (req, res) => {
  return res.json(Object.values(dataStore))
})

app.post('/v1/observations', bodyParser.json(), (req, res) => {
  const id = Date.now()
  dataStore[id] = { id, photos: [], obsFields: [], ...req.body }
  setTimeout(() => {
    res.json(dataStore[id])
  }, 195)
})

app.post('/v1/photos', formidable(), (req, res) => {
  const obsId = req.fields.obsId
  const record = dataStore[obsId]
  if (!record) {
    return res.status(404).json({ msg: 'No obs found for ID=' + obsId })
  }
  const isFirstPhoto = record.photos.length === 1
  if (isReturnSyntheticError()) {
    console.log(
      new Date().toLocaleString() + '  triggering a synthetic error on /photos',
    )
    // thanks https://stackoverflow.com/a/56642321/1410035
    return res.connection.destroy()
  }
  record.photos.push({ ...req.fields, file: 'discarded for demo' })
  dataStore[obsId] = record
  setTimeout(() => {
    res.json(record)
  }, 195)
})

app.post('/v1/obs-fields', bodyParser.json(), (req, res) => {
  const obsId = req.body.obsId
  const record = dataStore[obsId]
  if (!record) {
    return res.status(404).json({ msg: 'No obs found for ID=' + obsId })
  }
  record.obsFields.push(req.body.field)
  dataStore[obsId] = record
  setTimeout(() => {
    res.json(record)
  }, 195)
})

app.post('/v1/project_observations', bodyParser.json(), (req, res) => {
  const obsId = req.body.obsId
  const record = dataStore[obsId]
  if (!record) {
    return res.status(404).json({ msg: 'No obs found for ID=' + obsId })
  }
  record.project = req.body.projectId
  dataStore[obsId] = record
  setTimeout(() => {
    res.json(record)
  }, 195)
})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))

function isReturnSyntheticError() {
  return Math.random() < chanceOfError
}
