export type ScanApiErrorCode =
  | 'missing_api_key'
  | 'no_image'
  | 'model_overloaded'
  | 'parse_failed'
  | 'unknown'

export class ScanApiError extends Error {
  code: ScanApiErrorCode
  status: number

  constructor(message: string, code: ScanApiErrorCode, status = 500) {
    super(message)
    this.code = code
    this.status = status
  }
}
