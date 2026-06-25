import { describe, expect, it } from 'vitest'
import {
    createHostedControlPlaneDb,
    createHostedFullDb,
    expectTableConstraint,
    insertHostedAuthRow,
    normalizeSqlFragment,
    readHostedMigration,
} from './hosted-d1-schema-contract-support'

describe('hosted D1 schema contract', () => {
    it('enforces workspace ownership for hosted room state, jobs, and usage rows', () => {
        const sql = readHostedMigration()

        expectTableConstraint({
            sql,
            tableName: 'hosted_room',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_provider_connection',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_job',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_usage_event',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_ledger_entry',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_reservation',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_provider_connection',
            constraint: `
                FOREIGN KEY (workspace_id, credential_secret_id)
                    REFERENCES hosted_secret(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room',
            constraint: `
                FOREIGN KEY (workspace_id, created_by_user_id)
                    REFERENCES member(organizationId, userId)
            `,
        })
        for (const tableName of [
            'hosted_room_runtime_state',
            'hosted_room_job',
            'hosted_usage_event',
            'hosted_room_mcp_binding',
            'hosted_room_secret',
        ]) {
            expectTableConstraint({
                sql,
                tableName,
                constraint: `
                    FOREIGN KEY (workspace_id, room_id)
                        REFERENCES hosted_room(workspace_id, id)
                        ON DELETE CASCADE
                `,
            })
        }
        expectTableConstraint({
            sql,
            tableName: 'hosted_mcp_connection',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_mcp_connection',
            constraint: `
                FOREIGN KEY (workspace_id, credential_secret_id)
                    REFERENCES hosted_secret(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_workspace_settings',
            constraint: `
                FOREIGN KEY (workspace_id, default_provider_connection_id)
                    REFERENCES hosted_provider_connection(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_config',
            constraint: `
                FOREIGN KEY (workspace_id, provider_connection_id)
                    REFERENCES hosted_provider_connection(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_config',
            constraint: `
                FOREIGN KEY (workspace_id, image_secret_id)
                    REFERENCES hosted_secret(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_mcp_binding',
            constraint: `
                FOREIGN KEY (workspace_id, mcp_connection_id)
                    REFERENCES hosted_mcp_connection(workspace_id, id)
                    ON DELETE CASCADE
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_secret',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_secret',
            constraint: `
                FOREIGN KEY (workspace_id, secret_id)
                    REFERENCES hosted_secret(workspace_id, id)
                    ON DELETE CASCADE
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_usage_event',
            constraint: `
                FOREIGN KEY (workspace_id, job_id)
                    REFERENCES hosted_room_job(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_ledger_entry',
            constraint: `
                FOREIGN KEY (workspace_id, usage_event_id)
                    REFERENCES hosted_usage_event(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_usage_event',
            constraint: `
                FOREIGN KEY (workspace_id, billing_ledger_entry_id)
                    REFERENCES hosted_billing_ledger_entry(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        for (const constraint of [
            `
                FOREIGN KEY (workspace_id, job_id)
                    REFERENCES hosted_room_job(workspace_id, id)
                    ON DELETE RESTRICT
            `,
            `
                FOREIGN KEY (workspace_id, usage_event_id)
                    REFERENCES hosted_usage_event(workspace_id, id)
                    ON DELETE RESTRICT
            `,
            `
                FOREIGN KEY (workspace_id, billing_ledger_entry_id)
                    REFERENCES hosted_billing_ledger_entry(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        ]) {
            expectTableConstraint({
                sql,
                tableName: 'hosted_billing_reservation',
                constraint,
            })
        }
        for (const triggerName of [
            'hosted_room_delete_clear_usage_event_room_id',
            'hosted_room_job_delete_clear_usage_event_job_id',
            'hosted_billing_ledger_entry_delete_clear_usage_event_ledger_id',
            'hosted_usage_event_delete_clear_billing_ledger_usage_id',
            'hosted_room_delete_clear_billing_reservation_room_id',
            'hosted_room_job_delete_clear_billing_reservation_job_id',
            'hosted_usage_event_delete_clear_billing_reservation_usage_id',
            'hosted_billing_ledger_entry_delete_clear_billing_reservation_ledger_id',
        ]) {
            expect(normalizeSqlFragment(sql)).toContain(
                normalizeSqlFragment(`CREATE TRIGGER ${triggerName}`),
            )
        }
    })

    it('enforces owner-only hosted membership from the baseline schema', async () => {
        const db = await createHostedControlPlaneDb()
        try {
            const now = new Date(0).toISOString()
            await insertHostedAuthRow({
                db,
                userId: 'user_1',
                organizationId: 'workspace_1',
                memberId: 'member_1',
            })

            await expect(
                db.execute({
                    sql: `
                        INSERT OR IGNORE INTO member (
                            id,
                            organizationId,
                            userId,
                            role,
                            createdAt
                        )
                        VALUES ('member_1', 'workspace_1', 'user_1', 'owner', ?1)
                    `,
                    args: [now],
                }),
            ).resolves.toBeDefined()

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO invitation (
                            id,
                            organizationId,
                            email,
                            role,
                            status,
                            expiresAt,
                            createdAt,
                            inviterId
                        )
                        VALUES ('invitation_1', 'workspace_1', 'invitee@example.test', 'owner', 'pending', ?1, ?1, 'user_1')
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/invitations/)

            await expect(
                insertHostedAuthRow({
                    db,
                    userId: 'user_non_owner',
                    organizationId: 'workspace_non_owner',
                    memberId: 'member_non_owner',
                    role: 'member',
                }),
            ).rejects.toThrow(/owner-only/)

            await insertHostedAuthRow({
                db,
                userId: 'user_2',
                organizationId: 'workspace_2',
                memberId: 'member_2',
            })

            await expect(
                db.execute({
                    sql: `
                        INSERT OR REPLACE INTO member (
                            id,
                            organizationId,
                            userId,
                            role,
                            createdAt
                        )
                        VALUES ('member_1', 'workspace_2', 'user_2', 'owner', ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/Hosted/)
            const member = await db.execute({
                sql: 'SELECT organizationId, userId FROM member WHERE id = ?1',
                args: ['member_1'],
            })
            expect(member.rows[0]).toMatchObject({
                organizationId: 'workspace_1',
                userId: 'user_1',
            })

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO member (
                            id,
                            organizationId,
                            userId,
                            role,
                            createdAt
                        )
                        VALUES ('member_3', 'workspace_1', 'user_2', 'owner', ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/Hosted/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO organization (
                            id,
                            name,
                            slug,
                            logo,
                            createdAt,
                            metadata
                        )
                        VALUES ('workspace_3', 'workspace_3', 'workspace_3', NULL, ?1, '{}')
                    `,
                    args: [now],
                }),
            ).resolves.toBeDefined()

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO member (
                            id,
                            organizationId,
                            userId,
                            role,
                            createdAt
                        )
                        VALUES ('member_4', 'workspace_3', 'user_1', 'owner', ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/one workspace/)
        } finally {
            db.close()
        }
    })

    it('rejects cross-workspace hosted runtime config references at the database layer', async () => {
        const db = await createHostedFullDb()
        try {
            const now = new Date(0).toISOString()
            await insertHostedAuthRow({
                db,
                userId: 'user_1',
                organizationId: 'workspace_1',
                memberId: 'member_1',
            })
            await insertHostedAuthRow({
                db,
                userId: 'user_2',
                organizationId: 'workspace_2',
                memberId: 'member_2',
            })
            await db.execute({
                sql: `
                    INSERT INTO hosted_room (
                        id,
                        workspace_id,
                        slug,
                        display_name,
                        status,
                        desired_state,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES ('room_1', 'workspace_1', 'room-1', 'Room 1', 'stopped', 'stopped', 'user_1', ?1, ?1)
                `,
                args: [now],
            })
            await db.execute({
                sql: `
                    INSERT INTO hosted_provider_connection (
                        id,
                        workspace_id,
                        label,
                        provider,
                        auth_mode,
                        api,
                        base_url,
                        default_model,
                        fallback_models,
                        credential_secret_id,
                        status,
                        validation_message,
                        last_validated_at,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES ('provider_2', 'workspace_2', 'Provider 2', 'openai', 'api_key', 'openai-completions', NULL, 'gpt-test', '[]', NULL, 'ready', NULL, NULL, 'user_2', ?1, ?1)
                `,
                args: [now],
            })
            await db.execute({
                sql: `
                    INSERT INTO hosted_mcp_connection (
                        id,
                        workspace_id,
                        name,
                        server_key,
                        transport,
                        command,
                        args,
                        url,
                        headers,
                        auth_mode,
                        credential_secret_id,
                        allowed_tools,
                        status,
                        validation_message,
                        last_validated_at,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES ('mcp_2', 'workspace_2', 'MCP 2', 'mcp-2', 'http', NULL, '[]', 'https://mcp.example.test', '{}', 'none', NULL, '[]', 'ready', NULL, NULL, 'user_2', ?1, ?1)
                `,
                args: [now],
            })
            await db.execute({
                sql: `
                    INSERT INTO hosted_secret (
                        id,
                        workspace_id,
                        key_name,
                        cipher_text,
                        nonce,
                        auth_tag,
                        key_version,
                        created_at,
                        updated_at
                    )
                    VALUES ('secret_2', 'workspace_2', 'secret-2', 'cipher', 'nonce', 'tag', 1, ?1, ?1)
                `,
                args: [now],
            })

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_provider_connection (
                            id,
                            workspace_id,
                            label,
                            provider,
                            auth_mode,
                            api,
                            base_url,
                            default_model,
                            fallback_models,
                            credential_secret_id,
                            status,
                            validation_message,
                            last_validated_at,
                            created_by_user_id,
                            created_at,
                            updated_at
                        )
                        VALUES ('provider_cross_secret', 'workspace_1', 'Provider Cross Secret', 'openai', 'api_key', 'openai-completions', NULL, 'gpt-test', '[]', 'secret_2', 'ready', NULL, NULL, 'user_1', ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_mcp_connection (
                            id,
                            workspace_id,
                            name,
                            server_key,
                            transport,
                            command,
                            args,
                            url,
                            headers,
                            auth_mode,
                            credential_secret_id,
                            allowed_tools,
                            status,
                            validation_message,
                            last_validated_at,
                            created_by_user_id,
                            created_at,
                            updated_at
                        )
                        VALUES ('mcp_cross_secret', 'workspace_1', 'MCP Cross Secret', 'mcp-cross-secret', 'http', NULL, '[]', 'https://mcp.example.test', '{}', 'bearer', 'secret_2', '[]', 'ready', NULL, NULL, 'user_1', ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_workspace_settings (
                            workspace_id,
                            default_provider_connection_id,
                            default_model,
                            capability_defaults,
                            search_config,
                            image_config,
                            onboarding_completed_at,
                            created_at,
                            updated_at
                        )
                        VALUES ('workspace_1', 'provider_2', NULL, '{}', '{}', '{}', NULL, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_room_config (
                            room_id,
                            workspace_id,
                            instructions,
                            provider_mode,
                            provider_connection_id,
                            room_mode,
                            capability_overrides,
                            image_provider,
                            image_model,
                            image_secret_id,
                            cron_timezone,
                            browser_action_budget,
                            created_at,
                            updated_at
                        )
                        VALUES ('room_1', 'workspace_1', '', 'app_connection', 'provider_2', 'coworker', '{}', NULL, NULL, NULL, 'UTC', 50, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_room_config (
                            room_id,
                            workspace_id,
                            instructions,
                            provider_mode,
                            provider_connection_id,
                            room_mode,
                            capability_overrides,
                            image_provider,
                            image_model,
                            image_secret_id,
                            cron_timezone,
                            browser_action_budget,
                            created_at,
                            updated_at
                        )
                        VALUES ('room_1', 'workspace_1', '', 'app_default', NULL, 'coworker', '{}', 'openai', 'gpt-image-test', 'secret_2', 'UTC', 50, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_room_mcp_binding (
                            workspace_id,
                            room_id,
                            mcp_connection_id,
                            allowed_tools,
                            enabled,
                            created_at,
                            updated_at
                        )
                        VALUES ('workspace_1', 'room_1', 'mcp_2', '[]', 1, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_room_secret (
                            id,
                            workspace_id,
                            room_id,
                            secret_id,
                            label,
                            env_key,
                            purpose,
                            provider,
                            created_by_user_id,
                            created_at,
                            updated_at
                        )
                        VALUES ('room_secret_1', 'workspace_1', 'room_1', 'secret_2', 'Secret', 'SECRET', 'generic', NULL, 'user_1', ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)
        } finally {
            db.close()
        }
    })
})
