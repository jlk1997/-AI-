/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Quality-tab invite. The API writes organization_members so the invitee
 * can generate/build — project_members alone is not enough.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, List, Select, Tag, Typography } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import { api, ApiError } from '../../services/api';
import { useT } from '../../services/i18n';
import { useAppStore } from '../../store';

const { Text } = Typography;

type MemberRow = {
  userId: string;
  email: string | null;
  handle: string | null;
  displayName: string | null;
  role: string;
};

type OrgRow = {
  id: string;
  name: string;
  role: string;
};

function memberLabel(row: MemberRow): string {
  return row.displayName?.trim() || row.handle?.trim() || row.email || row.userId.slice(0, 8);
}

export const ProjectCollaboratorsStrip: React.FC<{
  readonly projectId: string;
  readonly refreshToken?: number;
}> = ({ projectId, refreshToken = 0 }) => {
  const { t } = useT();
  const orgId = useAppStore((s) => s.orgId);
  const setOrgId = useAppStore((s) => s.setOrgId);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [canInvite, setCanInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [people, mine] = await Promise.all([
        api.projects.members(projectId),
        api.orgs.list().catch(() => ({ orgs: [] as OrgRow[] })),
      ]);
      setMembers(people.members);
      setCanInvite(people.canInvite);
      setOrgs(mine.orgs);
    } catch {
      setMembers([]);
      setCanInvite(false);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const invite = async (): Promise<void> => {
    const trimmed = email.trim();
    if (!trimmed) {
      return;
    }
    setInviting(true);
    setError(null);
    setNotice(null);
    try {
      await api.projects.invite(projectId, trimmed);
      setEmail('');
      setNotice(t('generate.collab.invited'));
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        setError(t('generate.collab.notFound'));
      } else {
        setError(t('generate.collab.inviteFailed'));
      }
    } finally {
      setInviting(false);
    }
  };

  const roleLabel = (role: string): string => {
    if (role === 'owner') return t('generate.collab.role.owner');
    if (role === 'admin') return t('generate.collab.role.admin');
    return t('generate.collab.role.member');
  };

  return (
    <div style={{ marginTop: 16 }}>
      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        {t('generate.collab.title')}
      </Text>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
        {t('generate.collab.hint')}
      </Text>
      {orgs.length > 1 ? (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
            {t('generate.collab.newGamesGoTo')}
          </Text>
          <Select
            size="small"
            style={{ minWidth: 200 }}
            value={orgId && orgs.some((o) => o.id === orgId) ? orgId : orgs[0]?.id}
            options={orgs.map((org) => ({
              value: org.id,
              label: `${org.name} · ${roleLabel(org.role)}`,
            }))}
            onChange={(id) => setOrgId(id)}
          />
        </div>
      ) : null}
      {error ? (
        <Text type="danger" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text type="success" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
          {notice}
        </Text>
      ) : null}
      {canInvite ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <Input
            size="small"
            type="email"
            value={email}
            placeholder={t('generate.collab.emailPlaceholder')}
            onChange={(e) => setEmail(e.target.value)}
            onPressEnter={() => void invite()}
          />
          <Button
            size="small"
            type="primary"
            icon={<UserAddOutlined />}
            loading={inviting}
            onClick={() => void invite()}
          >
            {t('generate.collab.invite')}
          </Button>
        </div>
      ) : null}
      <List
        size="small"
        loading={loading}
        locale={{ emptyText: t('generate.collab.empty') }}
        dataSource={members}
        renderItem={(row) => (
          <List.Item style={{ padding: '4px 0' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 12 }}>{memberLabel(row)}</Text>
              {row.email && row.email !== memberLabel(row) ? (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {row.email}
                </Text>
              ) : null}
              <Tag>{roleLabel(row.role)}</Tag>
            </div>
          </List.Item>
        )}
      />
    </div>
  );
};
