export const endpointPrefix = 'http://localhost:3000/v1'

export const obsFieldName = 'obs'
export const photosFieldName = 'photos'
export const obsFieldsFieldName = 'obsFields'
export const projectIdFieldName = 'projectId'

export const syncDepsQueueMsg = 'SYNC_DEPS_QUEUE'
export const syncObsQueueMsg = 'SYNC_OBS_QUEUE'
export const refreshObsMsg = 'REFRESH_OBS'
export const failedToUploadObsMsg = 'OBS_FAIL'

const localServiceWorkerUrlPrefix = 'http://local.service-worker'
export const areYouActiveEndpoint =
  localServiceWorkerUrlPrefix + '/are-you-active'
export const obsBundleEndpoint =
  localServiceWorkerUrlPrefix + '/queue/obs-bundle'
