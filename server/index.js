const express = require('express')
const bodyParser = require('body-parser')
const formidable = require('express-formidable')
const cors = require('cors')
const app = express()
const port = 3000

app.use(cors())

const chanceOfFailedToFetch = parseFloat(process.env.CHANCE_FTF) || 0.3
console.log(
  `Chance of synthetic failed-to-fetch errors (CHANCE_FTF): ${chanceOfFailedToFetch}`,
)
const chanceOf500 = parseFloat(process.env.CHANCE_500) || 0.3
console.log(`Chance of synthetic 500 errors (CHANCE_500): ${chanceOf500}`)
const fakeSleepMs = parseInt(process.env.FAKE_SLEEP_MS) || 195
console.log(`FAKE_SLEEP_MS: ${fakeSleepMs}`)

const dataStore = {}

app.get('/v1/observations', bodyParser.json(), (req, res) => {
  return res.json(Object.values(dataStore))
})

app.post('/v1/observations', bodyParser.json(), (req, res) => {
  if (isReturn500Error()) {
    return res.status(500).json({ msg: 'Server exploded or something' })
  }
  const isObsValid = !!req.body.foo
  if (!isObsValid) {
    return res
      .status(400)
      .json({ msg: 'Invalid observation provided. We wanna see that foo!' })
  }
  const id = Date.now()
  dataStore[id] = { id, photos: [], obsFields: [], ...req.body }
  setTimeout(() => {
    res.json(dataStore[id])
  }, 195)
})

app.put('/v1/observations/:obsId', bodyParser.json(), (req, res) => {
  const record = dataStore[req.params.obsId]
  if (!record) {
    return res
      .status(404)
      .json({ msg: 'No obs found for ID=' + req.params.obsId })
  }
  const val = parseInt(record.foo) || 0
  record.foo = val + 1
  dataStore[req.params.obsId] = record
  return res.json(record)
})

app.delete('/v1/observations/:obsId', bodyParser.json(), (req, res) => {
  const record = dataStore[req.params.obsId]
  if (!record) {
    return res
      .status(404)
      .json({ msg: 'No obs found for ID=' + req.params.obsId })
  }
  delete dataStore[req.params.obsId]
  return res.json(record)
})

app.post('/v1/photos', formidable(), (req, res) => {
  const obsId = req.fields.obsId
  const record = dataStore[obsId]
  if (!record) {
    return res.status(404).json({ msg: 'No obs found for ID=' + obsId })
  }
  if (isReturnFailedToFetchError()) {
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
  const isObsValid = !!req.body.field.value
  if (!isObsValid) {
    return res
      .status(400)
      .json({
        msg: 'Invalid obsField provided. You must supply a "value" field',
      })
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

function isReturnFailedToFetchError() {
  return Math.random() < chanceOfFailedToFetch
}

function isReturn500Error() {
  return Math.random() < chanceOf500
}
