/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Path contract for the v1 assembler. Adding a route requires a line here.
 */

export const V1_ROUTE_MANIFEST = [
  'POST /auth/dev-token',
  'POST /auth/magic/request',
  'POST /auth/magic/verify',
  'POST /auth/email/request',
  'POST /auth/email/verify',
  'GET /auth/methods',
  'GET /me/logins',
  'POST /me/legal',
  'POST /me/export',
  'POST /me/delete',
  'GET /me/appeals',
  'POST /me/appeals',
  'POST /billing/checkout/stripe',
  'GET /billing/checkout/stripe',
  'POST /webhooks/stripe',
  'POST /sse-tickets',
  'GET /me',
  'GET /usage',
  'GET /admin/dead-letters',
  'GET /projects/:projectId/bench-runs',
  'GET /projects/:projectId/dead-letters',
  'POST /projects/:projectId/dead-letters/:letterId/requeue',
  'GET /projects/:projectId/build-cache',
  'GET /projects/:projectId/workspace-archive',
  'GET /orgs',
  'GET /projects/:projectId/members',
  'POST /projects/:projectId/members',
  'POST /projects/:projectId/build',
  'GET /projects/:projectId/templates',
  'POST /projects/:projectId/templates/rescaffold',
  'GET /templates',
  'POST /templates/:slug/apply',
  'GET /jobs/:jobId/log',
  'GET /billing/wallet',
  'POST /billing/orders',
  'GET /projects',
  'POST /projects',
  'GET /projects/:projectId/world',
  'GET /projects/:projectId/jobs',
  'GET /projects/:projectId/events',
  'GET /community/games',
  'GET /community/games/:gameId/society/snapshot',
  'GET /community/games/:gameId/society/stream',
  'POST /community/games/:gameId/presence',
  'POST /community/games/publish',
  'GET /public/billing/catalog',
  'POST /public/pay/wechat/notify',
  'POST /public/pay/alipay/notify',
  'POST /billing/orders/:orderId/reconcile',
  'POST /community/games/:gameId/jiaxi/consume',
  'GET /public/challenges/current',
] as const;

export type V1RouteManifestEntry = (typeof V1_ROUTE_MANIFEST)[number];
