#pragma once

#include <string>
#include <string_view>

namespace aedst::core {

/// Masks secrets in free-form log text. Applied to every message by AedstLogger
/// (LoggerConfig::redact, on by default), so a careless `info("{}", body)` cannot
/// put credentials into the log file users attach to support tickets.
///
/// Rules (ASCII case-insensitive, no regex):
///  - values of sensitive keys, in `key=value`, `key: value`, `"key":"value"` and
///    `'key':'value'` forms, become `***`. A key is sensitive if it contains
///    password, passwd, token, secret, api_key/api-key/apikey, authorization or
///    cookie (so access_token, refresh_token, client_secret, set-cookie, x-api-key
///    all match). For authorization/cookie/set-cookie an unquoted value runs to the
///    end of the line (`Bearer x`, `a=b; c=d`); other unquoted values stop at
///    whitespace , ; & ) ] } or a quote.
///  - `Bearer <credential>` anywhere becomes `Bearer ***`.
///  - e-mail addresses are partially masked: `alice@example.com` -> `a***@e***.com`
///    (first character of the local part and of the domain, plus the last label).
/// The mask has a fixed length so it does not leak the secret's size. Redaction is
/// idempotent. It is best effort, not a substitute for not logging secrets.
[[nodiscard]] std::string redactSecrets(std::string_view text);

/// What may leave the machine in a crash report or an error event: everything redactSecrets() masks, plus the account
/// name inside user-profile paths (`C:\Users\alice\AppData\...`, `/home/alice/.config`), which crash reporters embed in
/// file names and messages. The name becomes `<user>`; the rest of the path is kept because it tells where the failure
/// is. Idempotent, best effort.
[[nodiscard]] std::string scrubPii(std::string_view text);

} // namespace aedst::core
