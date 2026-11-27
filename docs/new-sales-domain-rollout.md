# BrokerFlow sales-domain rollout

## Important: destructive schema replacement

The migration `database/migrations/20261127_sales_client_domain.sql` intentionally replaces the legacy application domain. It preserves the existing `company_dropdown` table and its rows, but drops the legacy `Company`, `Team`, `Visit`, `CompanyMember`, `TeamMember`, `VisitAssignment`, `GoogleSheetRecord`, and `broker_activity` tables before creating the new domain tables.

Do not run this migration against production until:
1. A full database backup has been created and tested.
2. The owner has confirmed that all legacy application data other than `company_dropdown` may be discarded.
3. The application is deployed with the matching backend and Android/Web versions.

No production or Railway migration is performed by this branch.

## New role model

- `OPERATION_DIRECTOR`: read-only access to all sales activity and team data.
- `SALES_MANAGER`: read-only access to activities created by Sales Men in teams managed by that manager.
- `SALES_MAN`: creates Visits, Orientations, Workshops and Ads; can read their own records.

A Sales Manager can manage zero or multiple teams. A Sales Man may have no team or one team. Activities have a `salesId` foreign key and do not contain `teamId`; manager/team queries resolve membership through `User.teamId`.

## Bootstrap the first Operation Director

The schema migration gives existing users the default role `SALES_MAN`. After migration and before enabling the dashboard for leadership, promote the nominated account in MySQL:

```sql
UPDATE `User`
SET `role` = 'OPERATION_DIRECTOR'
WHERE `email` = 'director@example.com';
```

Replace the example email with the designated account. Verify exactly one row was updated:

```sql
SELECT `id`, `fullName`, `email`, `role`, `isActive`
FROM `User`
WHERE `email` = 'director@example.com';
```

The Operation Director can then provision Sales Manager and Sales Man accounts through `POST /api/users`. Public registration remains disabled unless `ALLOW_PUBLIC_REGISTRATION=true`; when enabled, it can only create a Sales Man account.

## Team management endpoints

- `GET /api/teams`: list teams visible to the current role.
- `POST /api/teams`: Sales Manager creates a team for themselves; Operation Director can provide `managerId`.
- `POST /api/teams/:teamId/members`: add a Sales Man using `salesId`.
- `DELETE /api/teams/:teamId/members/:salesId`: unassign a Sales Man.
- `PATCH /api/teams/:teamId`: rename or deactivate a team.
- `GET /api/users`: list users visible to the current role.
- `POST /api/users`: Operation Director provisions a Sales Manager or Sales Man.
- `PATCH /api/users/:userId/status`: Operation Director disables/enables an account. Disabling revokes its refresh sessions.

## Visit source workflow

`Visit.source` is `DIRECT` or `INDIRECT`.

- Direct: the request includes `sourceDetails`; the backend creates a `client_source` row and links it to the visit.
- Indirect: the request includes `clientSourceId`; the backend verifies that the source belongs to the authenticated Sales Man.
- The client is stored in `client`; a visit references `salesId`, `clientId`, `source` and `clientSourceId`. Visits do not reference a Company or Team.
- A Sales Man can have only one `IN_PROGRESS` visit at a time. Completing the visit changes status to `COMPLETED` and records end time and GPS.

## Orientation and Workshop workflow

- An Orientation request upserts a normalized Company and inserts an `orientation` row in one transaction.
- A Workshop can only be created for a Company where the same Sales Man has a completed Orientation.
- Both activity types use `IN_PROGRESS` and `COMPLETED` only.

## Authentication

- Passwords remain bcrypt hashes.
- Login returns a 15-minute JWT access token and a 30-day refresh token.
- The refresh token is stored only as a SHA-256 hash in `auth_session`; refresh rotates and revokes the previous session token.
- Protected requests verify the JWT session against the database and load the current role and active state from `User`.
- Logout revokes the current refresh session. Disabling a user revokes all sessions for that user.
- Android stores access and refresh tokens with AndroidX EncryptedSharedPreferences and refreshes the access token after a 401 response.

## Preserved table

`company_dropdown` remains as a disconnected legacy data table. The new Company, Orientation and Visit workflows do not read from or write to it.
