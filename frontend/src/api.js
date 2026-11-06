// Thin fetch wrapper. Errors come back as { status, message, errors: {field: msg} }.
export async function api(path, { method = 'GET', body, form, token, leader } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (leader) headers.Authorization = `Leader ${leader}`
  if (body) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetch('/api/v1' + path, { method, headers, body: form || (body && JSON.stringify(body)) })
  } catch {
    throw { status: 0, message: 'No connection. Check your internet and try again.', errors: {} }
  }
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json() : res
  if (!res.ok) {
    const d = data.detail
    throw {
      status: res.status,
      errors: d?.errors || {},
      message: typeof d === 'string' ? d : d?.errors ? 'Some fields need fixing.' : `Something went wrong (${res.status}).`,
    }
  }
  return data
}

export const STATUS_TEXT = {
  submitted: ['Payment submitted', 'We have your sign-up. An organiser will check your UTR against the bank statement, usually within 24 hours.'],
  verified: ['Payment verified', 'Your ₹300 is confirmed. Next we check your rank on tracker.gg.'],
  approved: ['Approved', "You're in. Leaders get their access link on WhatsApp; players enter the auction pool."],
  rejected: ['Rejected', 'See the reason below. Message the organisers if you think this is a mistake.'],
  waitlisted: ['Waitlisted', 'All 8 leader slots are taken. You can switch to auction player, or wait in case a leader drops out.'],
  withdrawn: ['Withdrawn', 'You have pulled out of the tournament. Refunds follow the refund policy.'],
}
