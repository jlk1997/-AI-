-- Repeatable official template channel. Worker maps official://* to env dirs.
INSERT INTO template_packages (
  slug,
  version,
  storage_key,
  name,
  description,
  is_public,
  price_points
)
VALUES
  (
    'core',
    '1.0.0',
    'official://core',
    'OpenGame Core',
    'Official Vite + Phaser workspace. Empty projects copy PLATFORM_GAME_TEMPLATE_DIR.',
    true,
    0
  ),
  (
    'skeleton',
    '1.0.0',
    'official://skeleton',
    'OpenGame Skeleton',
    'Minimal template-free skeleton. Empty projects copy PLATFORM_RUNTIME_SKELETON_DIR.',
    true,
    0
  )
ON CONFLICT (slug, version) DO NOTHING;

INSERT INTO schema_migrations (id)
VALUES ('0027_official_templates')
ON CONFLICT (id) DO NOTHING;
