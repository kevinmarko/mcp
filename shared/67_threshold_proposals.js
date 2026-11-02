// Threshold proposals: who may decide one, and how the app shows one (D84 Phase 2, slice 2b-3, research idea R-5). Q3 DECIDED
// 2026-10-30 ("Config Sheet map (Recommended)"): the lane's SPC lead plus Kevin approve threshold changes. The approver list is
// a tab of the Config Sheet; the server (apps-script/TeamSheet.gs, decideThresholdProposal) enforces the rule and these pure
// functions say the same thing to the app. Records only: nothing here feeds a value into a table, a highlight, a ceiling or a
// live threshold (rule 8); the MCT stays the source, and "live" only means the feed already shows the proposed value.
// Named 67_ so it sorts after 65_decisions.js, whose private helpers (decisions_clean, decisions_valueRecord, ...) it uses at
// call time.
//
//   BFShared.parseThresholdApprovers(rows)                    -> { approvers: [{ lane, email }], skipped }
//   BFShared.thresholdApproverLanes(approvers, email)         -> [lane], the lanes that email approves for
//   BFShared.thresholdProposerOf(records, id)                 -> the author of the value that record id decides, or ''
//   BFShared.thresholdProposersOf(records, id)                -> [email], everyone who proposed that value in the chain
//   BFShared.thresholdApprovalCheck(c)                        -> { ok: true, as: 'admin'|'lead' } or { ok: false, error: CODE }
//   BFShared.thresholdProposals(records, currentRows, since)  -> [thresholdLog entry + { check, valueBy, state }]
//   BFShared.thresholdProposalChip(p)                         -> { show: false } or { show: true, tone, text }
//
// APPROVER ROWS. rows are the Config Sheet's "Threshold Approvers" tab below its header, one array per row: [lane, email, ...]
// (any further cells, such as a note, are ignored). lane is trimmed and upper-cased, 1 to 20 characters (a letter or digit,
// then letters, digits and space . _ -); email is trimmed and lower-cased and must look like an address (at most 254
// characters). A row whose two cells are both blank is ignored; any other row that breaks a rule is counted in skipped and
// never matches anyone. A lane may have several rows (a lead and a cover); one person may have rows for several lanes.
// approvers comes back without duplicates, sorted by lane, then email. rows that are not an array give { approvers: [],
// skipped: 0 }; an entry that is not an array is skipped.
//
// LANES. thresholdApproverLanes(approvers, email) is the sorted, distinct lanes of the entries whose email equals email
// (trimmed, lower-cased); [] for anything that is not a list or not an address.
//
// PROPOSER. thresholdProposerOf(records, id) walks back from record id through supersedes to the record whose value it
// decides (shared/65_decisions.js's VALUE RULE: the first 'proposed' record found walking back) and gives that record's author.
// That is who may not approve it ("a proposer can't approve their own proposal"): the person who proposed THIS value, not the
// first person in the chain (someone else's re-proposal of a new value is a new value). '' when id names no valid threshold
// record.
// thresholdProposersOf(records, id) closes the laundering gap (security review, 2026-10-31): walking back from record id through
// supersedes (a visited set ends a cycle), the distinct authors of every 'proposed' record whose field and to are the decided
// value's (to equal within 1e-9), sorted. When B re-proposes the very value A proposed, both are proposers of it. [] when id
// names no valid threshold record.
//
// CHECK. c = { status, me, proposer, proposers?, targetRejected?, admin, configured, approverLanes, lane }: status is
// 'approved' or 'rejected'; me is the signed-in email; proposer is thresholdProposerOf's answer and proposers (optional)
// thresholdProposersOf's; targetRejected is true when the record being decided is a VERIFIED checked rejection (only the
// server can tell, so the page passes p.state === 'rejected' from getThresholdProposals' data); admin is true only for the project's admin (the server's existing
// admin check, apps-script/Code.gs assertArchiveAdmin_; Kevin); configured is false when the approver tab does not exist (the
// map is absent); approverLanes is thresholdApproverLanes for me; lane is the proposal's lane ('' when it is not known). The
// first rule that applies decides, in this order:
//   'invalid-status'            status is neither 'approved' nor 'rejected' (trimmed, lower-cased)
//   'no-user-identity'          me is not an address
//   'approvers-not-configured'  configured is not true: approvals fail closed, the admin's included, until the tab exists
//   'proposal-rejected'         status 'approved' and targetRejected is true: a rejected (withdrawn) proposal cannot be
//                               revived by approving the rejection; propose it again instead
//   'own-proposal'              status 'approved' and me is the proposer or one of proposers (the admin's included); a
//                               rejection of one's own proposal is a withdrawal and is allowed to anyone who may decide
//   { ok: true, as: 'admin' }   admin is true
//   'lane-unknown'              lane is blank (the server could not tell the sailing's lane from the feed)
//   { ok: true, as: 'lead' }    lane is one of approverLanes
//   'not-approver'              anything else
// Emails and lanes are compared trimmed and case-insensitively. A c that is not an object is 'invalid-status'.
//
// PROPOSALS. thresholdProposals(records, currentRows, since) is BFShared.thresholdLog(records, currentRows, since), entry for
// entry and in its order, each a copy with three more keys:
//   check    the latest record's check ({ as, lane }) or null: a decision the server checked carries one, one saved through
//            the older saveThresholdChange path (which checks no one) does not
//   valueBy  thresholdProposerOf for the latest record (who proposed the value shown)
//   state    'proposed'  the latest status is 'proposed'
//            'unchecked' approved or rejected, but with no check: shown as still awaiting a checked decision
//            'approved'  approved with a check, and the feed does not show the value (or the rows were not given)
//            'live'      approved with a check, and the feed shows the value (liveInFeed true)
//            'rejected'  rejected with a check
//
// CHIP. thresholdProposalChip(p), p a thresholdProposals entry. The row chip shows until the feed shows the new value, so it is
// hidden when liveInFeed is true, and for 'live' and 'rejected'. Otherwise:
//   'proposed', 'unchecked'  { show: true, tone: 'proposed', text: 'Threshold proposed 150% by ryan.t' }
//   'approved'               { show: true, tone: 'approved', text: 'Threshold approved 150% by kevin, not yet in feed' }
// The percent is to x 100 rounded to one decimal place, with no trailing '.0' (1.5 is 150%, 1.125 is 112.5%); the name is the
// part of the email before '@' (the decision card's convention), 'someone' when there is none (proposer for proposed and
// unchecked, the approver for approved). Anything else gives { show: false }.
//
// None of them reads a clock or any global but the ES5 built-ins and BFShared; none throws; none changes its input.

var thresholdProposals_STATUSES = ['approved', 'rejected'];

function thresholdProposals_text(v, lower) {
    var s;
    if (typeof v !== 'string') return '';
    s = decisions_trim(v);
    return lower ? s.toLowerCase() : s.toUpperCase();
}

function thresholdProposals_email(v) {
    var e = thresholdProposals_text(v, true);
    return (e.length <= decisions_EMAIL_MAX && decisions_EMAIL_PATTERN.test(e)) ? e : '';
}

function thresholdProposals_lane(v) {
    var l = thresholdProposals_text(v, false);
    return decisions_LANE_PATTERN.test(l) ? l : '';
}

// A row's cell: '' for a missing, null or undefined one, else the value as it is (a non-string is never a lane or an email).
function thresholdProposals_cell(row, i) {
    var v = row.length > i ? row[i] : '';
    return (v === null || v === undefined) ? '' : v;
}

BFShared.parseThresholdApprovers = function (rows) {
    var seen = {}, out = [], skipped = 0, i, row, lane, email, rawLane, rawEmail, k;
    try {
        if (!Array.isArray(rows)) return { approvers: [], skipped: 0 };
        for (i = 0; i < rows.length; i++) {
            row = rows[i];
            if (!Array.isArray(row)) { skipped++; continue; }
            rawLane = thresholdProposals_cell(row, 0);
            rawEmail = thresholdProposals_cell(row, 1);
            if (typeof rawLane === 'string' && typeof rawEmail === 'string' && decisions_trim(rawLane) === '' && decisions_trim(rawEmail) === '') continue;
            lane = thresholdProposals_lane(rawLane);
            email = thresholdProposals_email(rawEmail);
            if (lane === '' || email === '') { skipped++; continue; }
            k = decisions_key(lane + '\n' + email);
            if (decisions_has(seen, k)) continue;
            seen[k] = true;
            out.push({ lane: lane, email: email });
        }
        out.sort(function (a, b) { return decisions_cmp(a.lane, b.lane) || decisions_cmp(a.email, b.email); });
        return { approvers: out, skipped: skipped };
    } catch (e) {
        return { approvers: [], skipped: 0 };
    }
};

BFShared.thresholdApproverLanes = function (approvers, email) {
    var me, seen = {}, out = [], i, a, lane;
    try {
        me = thresholdProposals_email(email);
        if (!Array.isArray(approvers) || me === '') return [];
        for (i = 0; i < approvers.length; i++) {
            a = approvers[i];
            if (!decisions_isObject(a) || thresholdProposals_email(decisions_own(a, 'email')) !== me) continue;
            lane = thresholdProposals_lane(decisions_own(a, 'lane'));
            if (lane === '' || decisions_has(seen, decisions_key(lane))) continue;
            seen[decisions_key(lane)] = true;
            out.push(lane);
        }
        out.sort(decisions_cmp);
        return out;
    } catch (e) {
        return [];
    }
};

// The valid threshold records as { list, byId } (the shape decisions_valueRecord walks).
function thresholdProposals_clean(records) {
    var all = decisions_clean(records);
    var clean = { list: [], byId: {} };
    var i, r;
    for (i = 0; i < all.list.length; i++) {
        r = all.list[i];
        if (r.kind !== 'threshold') continue;
        clean.list.push(r);
        clean.byId[decisions_key(r.id)] = r;
    }
    return clean;
}

function thresholdProposals_proposer(clean, id) {
    var r;
    if (typeof id !== 'string') return '';
    r = decisions_get(clean.byId, decisions_key(decisions_trim(id)));
    return r ? decisions_valueRecord(clean, r).author : '';
}

function thresholdProposals_proposers(clean, id) {
    var seen = {}, out = [], r, v, k, e;
    if (typeof id !== 'string') return [];
    r = decisions_get(clean.byId, decisions_key(decisions_trim(id)));
    if (!r) return [];
    v = decisions_valueRecord(clean, r).payload;
    for (;;) {
        seen[decisions_key(r.id)] = true;
        if (r.payload.status === 'proposed' && r.payload.field === v.field && Math.abs(r.payload.to - v.to) <= 1e-9) {
            e = r.author;
            if (out.indexOf(e) === -1) out.push(e);
        }
        if (r.supersedes === '') break;
        k = decisions_key(r.supersedes);
        if (decisions_has(seen, k) || !decisions_has(clean.byId, k)) break;
        r = clean.byId[k];
    }
    out.sort(decisions_cmp);
    return out;
}

BFShared.thresholdProposersOf = function (records, id) {
    try {
        return thresholdProposals_proposers(thresholdProposals_clean(records), id);
    } catch (e) {
        return [];
    }
};

BFShared.thresholdProposerOf = function (records, id) {
    try {
        return thresholdProposals_proposer(thresholdProposals_clean(records), id);
    } catch (e) {
        return '';
    }
};

function thresholdProposals_check(c) {
    var status, me, lanes, lane, i, proposers;
    if (!decisions_isObject(c)) return decisions_fail('invalid-status');
    status = thresholdProposals_text(decisions_own(c, 'status'), true);
    if (thresholdProposals_STATUSES.indexOf(status) === -1) return decisions_fail('invalid-status');
    me = thresholdProposals_email(decisions_own(c, 'me'));
    if (me === '') return decisions_fail('no-user-identity');
    if (decisions_own(c, 'configured') !== true) return decisions_fail('approvers-not-configured');
    if (status === 'approved' && decisions_own(c, 'targetRejected') === true) return decisions_fail('proposal-rejected');
    if (status === 'approved' && me === thresholdProposals_email(decisions_own(c, 'proposer'))) return decisions_fail('own-proposal');
    proposers = decisions_own(c, 'proposers');
    if (status === 'approved' && Array.isArray(proposers)) {
        for (i = 0; i < proposers.length; i++) {
            if (thresholdProposals_email(proposers[i]) === me) return decisions_fail('own-proposal');
        }
    }
    if (decisions_own(c, 'admin') === true) return { ok: true, as: 'admin' };
    lane = thresholdProposals_lane(decisions_own(c, 'lane'));
    if (lane === '') return decisions_fail('lane-unknown');
    lanes = decisions_own(c, 'approverLanes');
    if (Array.isArray(lanes)) {
        for (i = 0; i < lanes.length; i++) {
            if (thresholdProposals_lane(lanes[i]) === lane) return { ok: true, as: 'lead' };
        }
    }
    return decisions_fail('not-approver');
}

BFShared.thresholdApprovalCheck = function (c) {
    try {
        return thresholdProposals_check(c);
    } catch (e) {
        return decisions_fail('invalid-status');
    }
};

BFShared.thresholdProposals = function (records, currentRows, since) {
    var log, clean, out, i, e, latest, check, copy, k, state;
    try {
        log = BFShared.thresholdLog(records, currentRows, since);
        clean = thresholdProposals_clean(records);
        out = [];
        for (i = 0; i < log.length; i++) {
            e = log[i];
            latest = decisions_get(clean.byId, decisions_key(e.latestId));
            check = latest && decisions_isObject(latest.payload.check) ? { as: latest.payload.check.as, lane: latest.payload.check.lane } : null;
            copy = {};
            for (k in e) {
                if (decisions_has(e, k)) copy[k] = e[k];
            }
            if (e.status === 'proposed') state = 'proposed';
            else if (check === null) state = 'unchecked';
            else if (e.status === 'rejected') state = 'rejected';
            else state = e.liveInFeed === true ? 'live' : 'approved';
            copy.check = check;
            copy.valueBy = latest ? thresholdProposals_proposer(clean, latest.id) : '';
            copy.state = state;
            out.push(copy);
        }
        return out;
    } catch (err) {
        return [];
    }
};

function thresholdProposals_pct(v) {
    var n = BFShared.thresholdValue(v);
    var x;
    if (n === null) return '';
    x = Math.round(n * 1000) / 10;
    return String(x) + '%';
}

function thresholdProposals_who(email) {
    var e = thresholdProposals_email(email);
    var at = e.indexOf('@');
    return at > 0 ? e.slice(0, at) : 'someone';
}

BFShared.thresholdProposalChip = function (p) {
    var state, pct;
    try {
        if (!decisions_isObject(p) || decisions_own(p, 'liveInFeed') === true) return { show: false };
        state = decisions_own(p, 'state');
        pct = thresholdProposals_pct(decisions_own(p, 'to'));
        if (pct === '') return { show: false };
        if (state === 'proposed' || state === 'unchecked') {
            return { show: true, tone: 'proposed', text: 'Threshold proposed ' + pct + ' by ' + thresholdProposals_who(decisions_own(p, 'valueBy')) };
        }
        if (state === 'approved') {
            return { show: true, tone: 'approved', text: 'Threshold approved ' + pct + ' by ' + thresholdProposals_who(decisions_own(p, 'updatedBy')) + ', not yet in feed' };
        }
        return { show: false };
    } catch (e) {
        return { show: false };
    }
};
