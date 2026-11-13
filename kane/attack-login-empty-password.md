# Kane test — attack: login-empty-password

Catalog: "Login accepts an empty password" (sign in).
Mutation: the password guard is removed from `patient/auth.js`. Healthy
behaviour: an empty password is always rejected, no exceptions.

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3100 \
  "Open the LoopMune store. In the sign-in form enter the email 'kane@example.com', leave the password field completely empty, and click 'Sign in'. Sign-in must be REJECTED with an error and no 'Signed in as' confirmation may appear. If sign-in succeeds, the check fails."
```

## Expected

- Healthy Patient (no mutation): exit 0 — attack repelled.
- Mutation injected: exit 1 — infection confirmed; the healer agent must
  restore the password guard in `patient/auth.js`; Kane re-verifies.
