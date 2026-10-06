import { StringDecoder } from 'node:string_decoder'

// This is the entire allowed app-stderr protocol. It matches the fixed marker
// from media-storage.ts; app stderr must never be forwarded as general logs.
export const MAX_APP_JOURNAL_LINE_LENGTH = 128
const marker = /^CMS_MEDIA_JOURNAL_ADVANCE_FAILED phase=(open|write|sync|close|rename) errno=(EACCES|EPERM|EEXIST|ENOENT|EBUSY|EIO|ENOSPC|EMFILE|OTHER)$/

export function createAppJournalOutputFilter(writeLine) {
  const decoder = new StringDecoder('utf8')
  let pending = '', dropping = false, ended = false
  function disable() { ended = true; pending = ''; dropping = false }

  function emit(line) {
    const match = marker.exec(line)
    if (!match || match[0] !== line) return
    try { writeLine(`CMS_E2E APP_JOURNAL phase=${match[1]} errno=${match[2]}\n`) }
    catch { disable() }
  }

  function consume(text) {
    let offset = 0
    while (offset < text.length && !ended) {
      const newline = text.indexOf('\n', offset)
      const end = newline === -1 ? text.length : newline
      if (!dropping) {
        if (pending.length + end - offset > MAX_APP_JOURNAL_LINE_LENGTH) { pending = ''; dropping = true }
        else pending += text.slice(offset, end)
      }
      if (newline === -1) break
      if (!dropping) emit(pending.endsWith('\r') ? pending.slice(0, -1) : pending)
      pending = ''; dropping = false; offset = newline + 1
    }
  }

  return {
    push(chunk) {
      if (ended) return
      try { consume(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? decoder.write(chunk) : '') }
      catch { disable() }
    },
    end() {
      if (ended) return
      try {
        consume(decoder.end())
        // A final exact record is complete even without a newline. Other tails
        // and an oversized line are discarded; a second end cannot duplicate it.
        if (!dropping && pending) emit(pending)
      } catch { /* Diagnostic failures cannot change child or cleanup status. */ }
      disable()
    },
    disable,
  }
}
