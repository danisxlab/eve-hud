// SPDX-License-Identifier: GPL-3.0-or-later
import { h, fmt, emptyState } from '../util.js';
import { store } from '../store.js';
import { switchTab } from '../fx.js';
import { ICONS } from '../glyphs.js';
import { renderParts, close as closeLink } from '../showinfo.js';

export default {
  id: 'chat',
  title: 'Chat',
  glyph: ICONS.chat,
  mount(ctx) {
    const all = store.config.chatChannels || [
      { id: 'local', label: 'Local' },
      { id: 'corp', label: 'Corp' },
    ];
    // the Militia tab only while you're enlisted in Faction Warfare (your character's faction_id)
    const enlisted = () => Boolean(store.feed('character')?.data?.factionId);
    const shown = () => all.filter((c) => !c.fw || enlisted());
    let channels = shown();
    const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
    const msgs = h('div', { class: 'msgs scroll', role: 'log', 'aria-live': 'polite' });
    const foot = h('div', { class: 'foot' });
    ctx.body.append(h('div', { class: 'chat' }, h('div', { class: 'bar-top' }, tabsEl), msgs, foot));

    let active = ctx.settings().chat?.tab || channels[0].id;
    if (!channels.some((c) => c.id === active)) active = channels[0].id; // e.g. Militia before the character is known
    const unread = Object.fromEntries(all.map((c) => [c.id, 0]));

    function renderTabs() {
      channels = shown();
      if (!channels.some((c) => c.id === active)) {
        active = channels[0].id;
        renderAll();
      } // left the militia
      tabsEl.replaceChildren(
        ...channels.map((c) =>
          h(
            'button',
            {
              class: `tab${c.id === active ? ' on' : ''}`,
              role: 'tab',
              'aria-selected': String(c.id === active),
              onclick: () => {
                active = c.id;
                unread[c.id] = 0;
                ctx.settings().chat.tab = c.id;
                ctx.save();
                renderTabs();
                switchTab(msgs, renderAll);
              },
            },
            c.label,
            unread[c.id] ? h('span', { class: 'badge' }, unread[c.id] > 99 ? '99+' : unread[c.id]) : null,
          ),
        ),
      );
    }

    function line(m, fresh = false) {
      return h(
        'div',
        { class: `msg${m.system ? ' sys' : ''}${m.self ? ' self' : ''}${fresh ? ' fresh' : ''}` },
        h('span', { class: 'ts' }, fmt.evetime(m.t)),
        h('span', { class: 'who' }, m.from),
        h(
          'span',
          { class: 'tx' },
          // item and system names arrive as links, made where the chat is read (lib/itemlinks.js)
          m.parts ? renderParts(m.parts) : m.text,
        ),
      );
    }

    const nearBottom = () => msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;

    function renderAll() {
      const list = store.chat.channels?.[active] || [];
      if (!list.length) {
        const st = store.chat.status;
        msgs.replaceChildren(
          st && !st.found
            ? emptyState(
                'EVE chat logs not found.',
                'Enable "Log chat to file" in EVE settings, or choose the folder in Settings → Storage → EVE logs.',
              )
            : emptyState('No messages yet.', 'New lines appear here as EVE writes them to the chat log.'),
        );
      } else {
        msgs.replaceChildren(...list.slice(-200).map((m) => line(m)));
        msgs.scrollTop = msgs.scrollHeight;
      }
      renderFoot();
    }

    function renderFoot() {
      const st = store.chat.status;
      const ch = st?.channels?.find((c) => c.id === active);
      ctx.setLight(ch?.file ? 'on' : st?.found ? 'warn' : 'off'); // the module's light follows the log file too
      foot.replaceChildren(
        h('span', { class: `led ${ch?.file ? 'on' : st?.found ? 'warn' : 'off'}` }),
        h(
          'span',
          { title: st?.dir || '' },
          ch?.file
            ? `Read-only · ${ch.file}`
            : st?.found
              ? `Waiting for a ${ch?.label || active} log file…`
              : 'Chat log folder not found',
        ),
      );
    }

    const offChat = store.on('chat', ({ channel, messages, initial }) => {
      if (initial || (channel === active && msgs.querySelector('.empty'))) {
        if (channel === active) renderAll();
        return;
      }
      if (channel !== active) {
        unread[channel] += messages.filter((m) => !m.system).length;
        renderTabs();
        return;
      }
      const stick = nearBottom();
      for (const m of messages) msgs.append(line(m, true));
      while (msgs.childElementCount > 250) msgs.firstChild.remove();
      if (stick) msgs.scrollTop = msgs.scrollHeight;
    });
    const offStatus = store.on('chatStatus', renderFoot);
    // enlisting or leaving shows or hides the Militia tab (a saved Militia tab comes back with it)
    const offChar = store.on('feed:character', () => {
      const saved = ctx.settings().chat?.tab;
      if (saved && saved !== active && shown().some((c) => c.id === saved)) {
        active = saved;
        renderTabs();
        renderAll();
      } else renderTabs();
    });
    const offSnap = store.on('snapshot', renderAll);

    renderTabs();
    renderAll();
    ctx.setSub(h('span', {}, 'Live from chat logs'));
    return {
      destroy() {
        offChat();
        offStatus();
        offChar();
        offSnap();
        closeLink();
      },
    };
  },
};
