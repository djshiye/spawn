# ArcMenu lifecycle & panel integration (condensed from analysis)

Base: scratchpad/src/ArcMenu/src/ (cited as file:line).

## enable() order (extension.js:19-75)
1. getSettings, register gresource (:20-23)
2. ArcMenuManager singleton (:25) — throws 'already initialized' if set; cleared only in destroy (arcmenuManager.js:3-4, 24-26)
3. SearchProviderEmitter monkeypatches SearchController.prototype.addProvider/removeProvider (searchProviders/searchProviderEmitter.js:16-32)
4. UpdateNotification (writes dconf update-notifier-project-version; MessageTray source never removed)
5. CustomStylesheet (async tmp file, theming.js:37-46)
6. hide-overview-on-startup: Main.sessionMode.hasOverview=false until startup-complete (:33-43); NOT restored in disable
7. _getPanelExtensionStates, settings multi-monitor/dash-to-panel-standalone -> _reload
8. _enableButtons (:159-214) builds MenuControllers  <-- throws here => ERROR, and nothing above is cleaned up
9. extensionManager 'extension-state-changed' (DtP/azTaskbar active flips -> reconnect + _reload)
10. global.dashToPanel/azTaskbar 'panels-created' -> _reload (connected to the emitter object of that moment)

## Panel discovery
- DtP: global.dashToPanel.panels[i] wrappers; .panel = inner St panel (has .statusArea, ._leftBox/_centerBox/_rightBox, addToStatusArea), .panelBox, .monitor, .isPrimary, .isStandalone, intellihide.
- DtP creates a NEW EventEmitter for global.dashToPanel on every enable (DtP extension.js:79, deleted :174) and sets .panels + emits 'panels-created' after building (panelManager.js:109-110). Wrappers always have .panel at construction (panel.js:117/168) => an undefined .panel means a STALE wrapper from a destroyed instance.
- azTaskbar: global.azTaskbar.panels, same idea.
- Fallback Main.panel / Main.layoutManager.panelBox.
- Button inserted with panel.addToStatusArea('ArcMenu', button, position, box); RIGHT position counts _rightBox children.
- Activities button hidden via statusArea.activities.visible (restored to true, not prior value).

## MenuController
- First panel only: D-Bus (com.Extensions.ArcMenu /com/Extensions/ArcMenu: ToggleArcMenu, ToggleStandaloneRunner), global.toggleArcMenu, Keybinder, recent-apps tracker, InputSourceManager.prototype._getCurrentWindow patch.
- ~35 settings trigger a full layout recreate (debounced 300 ms).

## MenuButton
- PanelMenu.Button subclass; two custom popups added to Main.uiGroup; dummy widget for forced positioning.
- Layout built EAGERLY and synchronously inside enable().
- Positioning via private _boxPointer fields, DtP geometry, workArea.

## Keybinder
- Super key: writes mutter 'overlay-key' via dconf, blocks GNOME's overlay-key handler found by signal_handler_find, connects own handler; restores on disable (never restored if ERROR).
- Custom accelerators via Main.wm.addKeybinding ('ToggleArcMenu', 'ToggleRunnerMenu'), debounced 300 ms.

## Fragility list (design MUST avoid all)
1. Stale DtP panel => TypeError in enable() => ERROR; partial state (D-Bus name, keybinder, input-source patch, popups in uiGroup) leaked.
2. Singleton guard + no cleanup on failed enable => re-enable impossible in-session.
3. Prototype patches (InputSourceManager, SearchController) left dangling with dead refs.
4. Teardown throws on stale DtP panel (unguarded statusArea) aborting the rest of teardown and the following enable.
5. hasOverview hack not restored on early disable; startup-complete deferrals not cancelled.
- 'panels-created' handler bound to old emitter never fires again; old handler can fire after disable.
- Two reload triggers per DtP restart; _reload has no debounce/re-entrancy guard.
- global.toggleArcMenu deleted by any controller destroy; keybinder tied to panel index 0.
- D-Bus callbacks after destroy throw.
- Overlay key stuck changed if never disabled.
- Update notifier closure uses nulled fields after disable.
- theming destroy races async tmp-file creation.
