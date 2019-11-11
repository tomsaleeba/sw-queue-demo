const express = require('express')
const bodyParser = require('body-parser')
const formidable = require('express-formidable')
const cors = require('cors')
const app = express()
const port = 3000

app.use(cors())

const dataStore = {}

app.get('/v1/observations', bodyParser.json(), (req, res) => {
  return res.json(Object.values(dataStore))
})

app.post('/v1/observations', bodyParser.json(), (req, res) => {
  const id = Date.now()
  dataStore[id] = { id, photos: [], ...req.body }
  return res.json(dataStore[id])
})

app.post('/v1/photos', formidable(), (req, res) => {
  const obsId = req.fields.obsId
  const record = dataStore[obsId]
  if (!record) {
    return res.status(404).json({ msg: 'No obs found for ID=' + obsId })
  }
  record.photos.push({ ...req.fields, file: 'discarded for demo' })
  dataStore[obsId] = record
  return res.json(req.body)
})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))
