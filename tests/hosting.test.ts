import { expect, it } from 'vitest'
import { hostingConfig } from '../server/hosting'

it('keeps local development on loopback without a password', () => {
  expect(hostingConfig({})).toEqual({ host: '127.0.0.1', port: 3001, access: undefined })
})
it('refuses public binding without complete access credentials', () => {
  expect(() => hostingConfig({ HOST: '0.0.0.0' })).toThrow('Public hosting requires')
  expect(() => hostingConfig({ APP_ACCESS_USER: 'dev' })).toThrow('Set both')
  expect(() => hostingConfig({ APP_ACCESS_USER: 'bad:user', APP_ACCESS_PASSWORD: 'test' })).toThrow('colon')
  expect(() => hostingConfig({ PORT: 'bad' })).toThrow('PORT')
})
it('supports authenticated platform hosting', () => {
  expect(hostingConfig({ HOST: '0.0.0.0', PORT: '10000', APP_ACCESS_USER: 'dev', APP_ACCESS_PASSWORD: 'test' }))
    .toEqual({ host: '0.0.0.0', port: 10000, access: { user: 'dev', password: 'test' } })
})
