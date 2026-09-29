// Our username rule, checked by the browser only (Nakama accepts more).
// ponytail: client-side rule; a Go BeforeAuthenticateEmail hook enforces it server-side later.
export const USERNAME = { pattern: '[A-Za-z0-9_]{3,20}', hint: '3 to 20 letters, digits or underscores. Shown to other players.' }
