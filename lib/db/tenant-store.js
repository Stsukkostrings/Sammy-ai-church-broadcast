const db = require('./supabase-rest');
const { encryptSecret, decryptSecret } = require('../auth/supabase');

function eq(value) { return `eq.${value}`; }

const LIST_PAGE_SIZE = 1000;
const MAX_LIST_ROWS = 2000;

async function listChannels(user, accessToken) {
    return (await db.request('youtube_channels', {
        accessToken, filters: db.scopedFilters(user.id, { select: 'channel_id,channel_title,connected_at,updated_at', order: 'connected_at.asc' })
    })) || [];
}

async function getChannel(user, accessToken, channelId) {
    if (!channelId) throw Object.assign(new Error('Choose a connected YouTube channel.'), { status: 409, code: 'CHANNEL_REQUIRED' });
    const rows = await db.request('youtube_channels', {
        accessToken, filters: db.scopedFilters(user.id, { channel_id: eq(channelId), select: '*' })
    });
    return rows?.[0] || null;
}

async function getChannelTokens(user, accessToken, channelId) {
    const channel = await getChannel(user, accessToken, channelId);
    if (!channel) throw Object.assign(new Error('This YouTube channel is not connected to your Omnicast account.'), { status: 404, code: 'CHANNEL_NOT_FOUND' });
    return { ...channel, accessToken: decryptSecret(channel.access_token_ciphertext, `yt-access:${user.id}:${channelId}`), refreshToken: channel.refresh_token_ciphertext ? decryptSecret(channel.refresh_token_ciphertext, `yt-refresh:${user.id}:${channelId}`) : null };
}

async function saveChannel(user, accessToken, channel) {
    const previous = await getChannel(user, accessToken, channel.channelId).catch(() => null);
    const refreshToken = channel.refreshToken || (previous?.refresh_token_ciphertext
        ? decryptSecret(previous.refresh_token_ciphertext, `yt-refresh:${user.id}:${channel.channelId}`)
        : null);
    return db.request('youtube_channels', {
        method: 'POST', accessToken,
        filters: { on_conflict: 'user_id,channel_id' },
        body: {
            user_id: user.id,
            channel_id: channel.channelId,
            channel_title: channel.title || null,
            access_token_ciphertext: encryptSecret(channel.accessToken, `yt-access:${user.id}:${channel.channelId}`),
            refresh_token_ciphertext: refreshToken ? encryptSecret(refreshToken, `yt-refresh:${user.id}:${channel.channelId}`) : null,
            token_expires_at: new Date(channel.expiresAt).toISOString(),
            last_synced_at: previous?.last_synced_at || null,
            last_sync_count: previous?.last_sync_count || 0,
            connected_at: previous?.connected_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
        }, prefer: 'resolution=merge-duplicates,return=representation'
    });
}

async function listComments(user, accessToken, channelId) {
    return listAll('comments', user, accessToken, { channel_id: eq(channelId), select: '*', order: 'published_at.desc' });
}

async function listCommentsPage(user, accessToken, channelId, { limit = 200, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const safeOffset = Math.max(0, Math.min(100_000, Number(offset) || 0));
    return (await db.request('comments', {
        accessToken,
        filters: db.scopedFilters(user.id, {
            channel_id: eq(channelId),
            select: '*',
            order: 'published_at.desc'
        }),
        range: `${safeOffset}-${safeOffset + safeLimit - 1}`
    })) || [];
}

async function listAll(table, user, accessToken, filters) {
    const rows = [];
    for (let start = 0; start < MAX_LIST_ROWS; start += LIST_PAGE_SIZE) {
        const page = await db.request(table, {
            accessToken,
            filters: db.scopedFilters(user.id, filters),
            range: `${start}-${start + LIST_PAGE_SIZE - 1}`
        }) || [];
        rows.push(...page);
        if (page.length < LIST_PAGE_SIZE || rows.length >= MAX_LIST_ROWS) return rows.slice(0, MAX_LIST_ROWS);
    }
    return rows;
}

async function getComment(user, accessToken, channelId, commentId) {
    const rows = await db.request('comments', {
        accessToken, filters: db.scopedFilters(user.id, { channel_id: eq(channelId), comment_id: eq(commentId), select: '*' })
    });
    return rows?.[0] || null;
}

async function upsertComments(user, accessToken, rows) {
    if (!rows.length) return [];
    return (await db.request('comments', {
        method: 'POST', accessToken, filters: { on_conflict: 'user_id,channel_id,comment_id' }, body: rows,
        prefer: 'resolution=merge-duplicates,return=representation'
    })) || [];
}

async function getDraft(user, accessToken, channelId, commentId) {
    const rows = await db.request('comment_drafts', {
        accessToken, filters: db.scopedFilters(user.id, { channel_id: eq(channelId), comment_id: eq(commentId), select: '*', limit: '1' })
    });
    return rows?.[0] || null;
}

async function listDrafts(user, accessToken, channelId) {
    return listAll('comment_drafts', user, accessToken, { channel_id: eq(channelId), select: '*', order: 'updated_at.desc' });
}

async function upsertDraft(user, accessToken, draft) {
    const rows = await db.request('comment_drafts', {
        method: 'POST', accessToken, filters: { on_conflict: 'user_id,channel_id,comment_id' }, body: { ...draft, user_id: user.id },
        prefer: 'resolution=merge-duplicates,return=representation'
    });
    return rows?.[0] || draft;
}

async function updateComment(user, accessToken, channelId, commentId, updates) {
    return db.request('comments', {
        method: 'PATCH', accessToken, filters: db.scopedFilters(user.id, { channel_id: eq(channelId), comment_id: eq(commentId) }), body: updates, prefer: 'return=representation'
    });
}

async function recordPublishedReply(user, accessToken, record) {
    return db.request('published_replies', {
        method: 'POST', accessToken, filters: { on_conflict: 'user_id,channel_id,comment_id' }, body: { ...record, user_id: user.id },
        prefer: 'resolution=ignore-duplicates,return=representation'
    });
}

async function listPublished(user, accessToken, channelId) {
    return listAll('published_replies', user, accessToken, { channel_id: eq(channelId), select: '*', order: 'published_at.desc' });
}

async function getSettings(user, accessToken) {
    return (await db.request('user_settings', {
        accessToken, filters: db.scopedFilters(user.id, { select: 'key,value,updated_at' })
    })) || [];
}

async function setSetting(user, accessToken, key, value) {
    return db.request('user_settings', {
        method: 'POST', accessToken, filters: { on_conflict: 'user_id,key' }, body: { user_id: user.id, key, value },
        prefer: 'resolution=merge-duplicates,return=representation'
    });
}

async function updateChannelSync(user, accessToken, channelId, count, at = new Date().toISOString()) {
    return db.request('youtube_channels', {
        method: 'PATCH', accessToken,
        filters: db.scopedFilters(user.id, { channel_id: eq(channelId) }),
        body: { last_synced_at: at, last_sync_count: count, updated_at: new Date().toISOString() },
        prefer: 'return=representation'
    });
}

async function claimPublish(user, accessToken, channelId, commentId) {
    return db.rpc('claim_comment_publish', { p_channel_id: channelId, p_comment_id: commentId }, accessToken);
}

async function releasePublish(user, accessToken, channelId, commentId) {
    return db.rpc('release_comment_publish', { p_channel_id: channelId, p_comment_id: commentId }, accessToken);
}

async function completePublish(user, accessToken, channelId, commentId, replyId, text) {
    return db.rpc('complete_comment_publish', { p_channel_id: channelId, p_comment_id: commentId, p_reply_id: replyId, p_text: text }, accessToken);
}

async function recoverStalePublish(user, accessToken, channelId, commentId = null) {
    return db.rpc('recover_stale_publish', {
        p_channel_id: channelId || null,
        p_comment_id: commentId || null,
        p_stale_after_seconds: 120
    }, accessToken);
}

module.exports = { listChannels, getChannel, getChannelTokens, saveChannel, listComments, listCommentsPage, getComment, upsertComments, getDraft, listDrafts, upsertDraft, updateComment, recordPublishedReply, listPublished, getSettings, setSetting, updateChannelSync, claimPublish, releasePublish, completePublish, recoverStalePublish };
