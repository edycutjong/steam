import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import App from '../App.tsx'

describe('scaffold smoke', () => {
  it('renders the app title', () => {
    expect(renderToString(<App />)).toContain('Her Hand in the Steam')
  })
})
