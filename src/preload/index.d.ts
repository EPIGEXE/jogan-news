import type { AinewsApi } from '../shared/ipc'

declare global {
  interface Window {
    ainews: AinewsApi
  }
}
