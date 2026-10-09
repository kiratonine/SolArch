import { setupWorker } from 'msw/browser'

import { addShowcase } from './db'
import { handlers } from './handlers'

// В браузере каталог полнее, чем в тестах: иначе постраничность не увидеть глазами.
addShowcase()

export const worker = setupWorker(...handlers)
