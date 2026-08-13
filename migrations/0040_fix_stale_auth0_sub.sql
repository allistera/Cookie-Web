-- 0040_fix_stale_auth0_sub.sql
-- users.auth0_sub was never updated during the 2026-07-12 Auth0 connection
-- cutover from Google to database email/password (migration 0009 repointed
-- users.email but left auth0_sub at its pre-cutover 'google-oauth2|...'
-- value). Commit 687a3ed reverted the API's user lookup from email back to
-- auth0_sub for security reasons (email claims are attacker-controllable),
-- which orphaned the mailbox again: every fresh token's sub is 'auth0|...'
-- and matches no row, so every request 401s. Point auth0_sub at the live
-- subject.

BEGIN;

UPDATE users
SET auth0_sub = 'auth0|6a53d46804689c37ba15aef5'
WHERE email = 'allisteraall@gmail.com';

COMMIT;
