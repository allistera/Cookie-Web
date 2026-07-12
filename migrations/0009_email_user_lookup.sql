-- 0009_email_user_lookup.sql
-- API lookups now key on users.email (from the access token's email claim)
-- instead of users.auth0_sub, so logins survive Auth0 connection changes —
-- the Google -> database email/password cutover changed the sub from
-- 'google-oauth2|...' to 'auth0|...', orphaning the mailbox. Point the
-- single user record at the mailbox owner's address and enforce the
-- uniqueness the new lookup relies on.

BEGIN;

UPDATE users SET email = 'allisteraall@gmail.com';

CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

COMMIT;
