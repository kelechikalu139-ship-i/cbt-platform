import { useCallback, useState } from 'react'

/**
 * Copy text to the clipboard, used for the LAN access URLs on System Health.
 *
 * `navigator.clipboard` needs a secure context. On a plain-HTTP LAN address
 * (http://192.168.1.100) it is unavailable in most browsers, so fall back to a
 * hidden textarea plus `execCommand`, and report failure so the caller can
 * select the text manually instead of silently doing nothing.
 */
export function useCopyToClipboard(resetAfterMs = 2000) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const copy = useCallback(
    async (text: string) => {
      setFailed(false)
      const succeeded = await writeToClipboard(text)
      if (succeeded) {
        setCopied(true)
        setTimeout(() => setCopied(false), resetAfterMs)
        return true
      }
      setFailed(true)
      setTimeout(() => setFailed(false), resetAfterMs)
      return false
    },
    [resetAfterMs],
  )

  return { copy, copied, failed }
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const succeeded = document.execCommand('copy')
    document.body.removeChild(textarea)
    return succeeded
  } catch {
    return false
  }
}
