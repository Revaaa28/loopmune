# Kane test — attack: login-empty-password

Catalog: "Login accepts empty password" (sign in).
Healthy behavior: an empty password is rejected. Fault behavior: sign-in
succeeds with no password at all.

## Command

```bash
export KANE_CLI_CHROME_PATH=/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
kane-cli run --agent --headless --url http://localhost:3000 \
  "Open the LoopMune store. In the Sign in form enter the email 'kane@example.com', leave the password field completely empty, and click 'Sign in'. Verify sign-in is REJECTED with an error message and no 'Signed in as' confirmation appears. If sign-in succeeds, the check fails."
```

## Expected

- Healthy Patient (fault OFF): exit 0 — attack repelled.
- Fault ON: exit 1 — infection confirmed; M2 restores the login guard and
  re-runs this exact test.
