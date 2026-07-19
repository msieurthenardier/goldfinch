export function createJarsClient({
  bridge,
  ctx,
  burner,
  isWebTab,
  isInternalTab,
  activateTab,
  closeTab,
  updateAutomationIndicator,
  getAutomationSnapshot,
  inheritContainerDecision,
  inheritFromPartition,
  random = Math.random,
}) {
  const state = { containers: [], defaultId: undefined };

  function refreshOpenTabJars() {
    const snapshot = [...ctx.tabs.values()];
    const orphans = [];
    for (const tab of snapshot) {
      if (tab.trusted || (tab.container && tab.container.burner)) continue;
      const fresh = state.containers.find((entry) => entry && tab.container && entry.id === tab.container.id);
      if (!fresh) { orphans.push(tab); continue; }
      tab.container = fresh;
      const dot = tab.btn && tab.btn.querySelector('.tab-jar');
      if (!dot) continue;
      dot.style.background = fresh.color;
      dot.title = fresh.name;
    }
    if (!orphans.length) return;
    if (orphans.some((tab) => tab.id === ctx.activeTabId)) {
      const survivor = snapshot.find((tab) => !orphans.includes(tab));
      if (survivor) activateTab(survivor.id);
    }
    const activeOrphan = orphans.find((tab) => tab.id === ctx.activeTabId);
    for (const tab of orphans) if (tab !== activeOrphan) closeTab(tab.id);
    if (activeOrphan) closeTab(activeOrphan.id);
  }

  function applyState(list, defaultId) {
    state.containers = Array.isArray(list) ? list : [];
    state.defaultId = defaultId;
    refreshOpenTabJars();
    updateAutomationIndicator(getAutomationSnapshot());
  }

  const boot = Promise.all([bridge.jarsList(), bridge.jarsGetDefault()])
    .then(([list, resolvedDefault]) => {
      applyState(list, resolvedDefault && resolvedDefault.id !== burner.id ? resolvedDefault.id : null);
    })
    .catch(() => {});

  bridge.onJarsChanged((payload) => {
    if (payload && Array.isArray(payload.containers)) applyState(payload.containers, payload.defaultId);
  });

  bridge.onJarWiped((payload) => {
    if (!payload || typeof payload.id !== 'string') return;
    const snapshot = [...ctx.tabs.values()];
    const matches = snapshot.filter((tab) =>
      tab.container && tab.container.id === payload.id && isWebTab(tab) && tab.wcId != null
    );
    if (!matches.length) return;
    if (matches.some((tab) => tab.id === ctx.activeTabId)) {
      const survivor = snapshot.find((tab) => !matches.includes(tab));
      if (survivor) activateTab(survivor.id);
    }
    const activeMatch = matches.find((tab) => tab.id === ctx.activeTabId);
    for (const tab of matches) if (tab !== activeMatch) closeTab(tab.id);
    if (activeMatch) closeTab(activeMatch.id);
  });

  function makeBurner() {
    const n = Math.floor(random() * 1e9);
    return {
      id: `burner-${n}`,
      name: burner.name,
      color: burner.color,
      partition: `burner:${n}`,
      burner: true
    };
  }

  function inheritContainerFrom(tab) {
    const decision = inheritContainerDecision(tab && tab.container, isInternalTab(tab));
    return decision.freshBurner ? makeBurner() : decision.container || null;
  }

  function inheritContainerFromPartition(openerPartition) {
    const decision = inheritFromPartition(openerPartition, state.containers);
    return decision.freshBurner ? makeBurner() : decision.container || null;
  }

  return {
    state,
    boot,
    applyState,
    refreshOpenTabJars,
    makeBurner,
    inheritContainerFrom,
    inheritContainerFromPartition,
    get containers() { return state.containers; },
    get defaultId() { return state.defaultId; },
  };
}
