const { app, BrowserWindow, WebContentsView, ipcMain, Menu, Tray, nativeImage, Notification, MenuItem, desktopCapturer, session, net } = require('electron');
const Store = require('electron-store').default;
const path  = require('node:path');
const fs    = require('node:fs');

// Single Electron Instance
if (!app.requestSingleInstanceLock()) {
	app.quit();
	return;
}

for (const arg of process.argv)
{
	if (arg.startsWith("--disable-gpu"))
	{
		console.log("WhatsApp Electron: Disabling GPU by --disable-gpu argument")
		app.disableHardwareAcceleration();
		app.commandLine.appendSwitch('disable-gpu');
		app.commandLine.appendSwitch('disable-gpu-compositing');
	}
}

class WhatsAppElectron
{
	constructor() {
		this.store      = new Store();
		this.baseIcon   = !app.isPackaged ? path.join(__dirname, "../assets/whatsapp-icon-512x512.png") : path.join(process.resourcesPath, "app.asar.unpacked/assets/whatsapp-icon-512x512.png");
		this.isQuit     = false;
		this.spellLangs = ["en-US", "pt-BR"];

		this.bounds = this.store.get("bounds");
		if (this.bounds == undefined)
		{
			this.bounds = {width: 1024, height: 768, x: null, y: null};
			this.store.set("bounds", this.bounds);
		}

		this.accounts  = this.store.get("accounts");
		this.instances = {};
		if (this.accounts == undefined)
		{
			this.accounts = [{id: "default", name: "Default Account"}];
			this.store.set("accounts", this.accounts);
		}

		this.menuTemplate = [
			{
				label: "WhatsApp",
				submenu: [
					{
						label: "Accounts",
						enabled: true,
						accelerator: "Alt+a",
						click: () => {
							this.removeViews();
							this.window.setTitle(`${Constants.appName} :: Accounts`);
						}
					}
				]
			},
			{
				label: 'Help',
				submenu:
				[
					{
						label: "Version undefined by me",
						enabled: false
					},
					{ type: 'separator' },
					{
						label: 'Open Development Tool',
						accelerator: "Ctrl+Shift+I",
						click: () => {
							const views = this.window.contentView.children;
							if (views.length > 0)
								views[views.length - 1].webContents.openDevTools();
							else
								this.window.webContents.openDevTools();
						}
					},
					{
						label: "Force Reload (instance)",
						accelerator: "Ctrl+R",
						click: () => {
							const views = this.window.contentView.children;
							if (views.length > 0)
							{
								const view = views[views.length - 1];
								view.webContents.reload();
								setTimeout(() => {
									view.webContents.send(Constants.event.initWhatsAppInstance, {id: view._id, name: view._name, constants: Constants});
								}, 1000);
							}
							else
							{
								this.window.webContents.reload();
								setTimeout(() => {
									this.window.webContents.send(Constants.event.initResources, {constants: Constants});
								}, 1000);
							}
						}
					},
					{ type: 'separator' },
					{
						label: "Quit",
						click: () => {
							this.isQuit = true;
							//app.quit();
							this.quit();
						}
					}
				]
			}
		];
	}

	_initElectronApp() {
		app.userAgentFallback = Constants.whatsapp.userAgent;
		
		if (process.platform == "win32")
			app.setAppUserModelId(Constants.appName);
	}

	init() {
		this._initElectronApp();

		// spell langs
		let langs = [];
		for (const arg of process.argv)
		{
			if (arg.startsWith("--spell-lang"))
			{
				const lang = arg.split("=")[1];
				langs.push(lang);
			}
		}
		if (langs.length > 0)
			this.spellLangs = langs;
		console.log(`WhatsApp Electron: Spell Check Enabled Languages: ${this.spellLangs}`);
		
		this.createWindow();

		for (const item of this.accounts)
			this.createView(item.id, item.name);

		// set version on menu
		this.menuTemplate[1].submenu[0].label = `Version ${Constants.version} (Electron@${process.versions.electron})`;

		this.menu = Menu.buildFromTemplate(this.menuTemplate);
		Menu.setApplicationMenu(this.menu);

		if (this.accounts.length > 0)
			this.setCurrentViewByIdx(0);

		const menu = Menu.buildFromTemplate([
			{label: "Show/Hide", click: () => { this.showHide(); }},
			{type: "separator"},
			{label: "Quit", click: () => { this.isQuit = true; this.quit(); }}
		]);

		this.tray = new Tray(this.baseIcon);
		this.tray.setContextMenu(menu);
		this.tray.setToolTip(Constants.appName);
		this.tray.on("click", () => { this.showHide(); });

		// Events
		this.aciveNotifications = [];
		ipcMain.on(Constants.event.newRendererNotification, (event, data) => {
			//console.log("New Renderer Notification...", data);
			const n = new Notification({
				title: `[${this.instances[data.id].name}] :: ${data.title}`,
				body: data.options.body,
				icon: nativeImage.createFromDataURL(data.icon),
				urgency: "normal"
			});
			n.on("click", (event) => {
				//console.log("Notification Clicked...", data.id, data.options.tag);
				this.showHide(false);
				this.setCurrentView(data.id);
				this.instances[data.id].view.webContents.send(Constants.event.fireNotificationClick, data.options.tag);
				this.aciveNotifications = this.aciveNotifications.filter(_n => _n !== n);
			});
			n.on("close", (event) => {
				this.aciveNotifications = this.aciveNotifications.filter(_n => _n !== n);
			});
			n.show();

			this.aciveNotifications.push(n);
		});

		ipcMain.on(Constants.event.updateUnreadMessages, (event, data) => {
			//console.log("Unread Messages: ", data);
			this.instances[data.id].unread = data.unread;
			this.updateTrayBadgeCounter();
		});

		ipcMain.on(Constants.event.updateBadgeIcon, (event, data) => {
			//console.log("Received updated badge icon...");
			this.tray.setImage(nativeImage.createFromDataURL(data));
		});
		
		ipcMain.on(Constants.event.reloadWhatsAppInstance, (envet, id) => {
			console.log("WhatsApp Electron: Received reloadWhatsAppInstance...", id);
			const bv = this.instances[id].view;
			bv.webContents.reload();
			setTimeout(() => {
				bv.webContents.send(Constants.event.initWhatsAppInstance, {id: bv._id, name: bv._name, constants: Constants});
			}, 1000);
		});
		ipcMain.on(Constants.event.clearWorkersAndReload, (envet, id) => {
			console.log("WhatsApp Electron: Received clearWorkersAndReload...", id);
			const ses = session.fromPartition(`persist:${id}`);
			ses.flushStorageData();
			ses.clearStorageData({ storages: ['serviceworkers'] });
			
			const bv = this.instances[id].view;
			bv.webContents.reload();
			setTimeout(() => {
				bv.webContents.send(Constants.event.initWhatsAppInstance, {id: bv._id, name: bv._name, constants: Constants});
			}, 1000);
		});
		
		ipcMain.handle(Constants.event.getAccountsList, () => {
			//console.log("From Renderer - getAccountsList", data);
			return this.accounts;
		});

		ipcMain.on(Constants.event.addAccount, (event, data) => {
			//console.log("From Renderer - addAccount", data);
			this.accounts.push(data);
			this.store.set("accounts", this.accounts);
			this.createView(data.id, data.name);
			
			this.menu = Menu.buildFromTemplate(this.menuTemplate);
			Menu.setApplicationMenu(this.menu);
			
			this.window.webContents.send(Constants.event.reloadAccounts);
		});
		
		ipcMain.on(Constants.event.updateAccount, (event, data) => {
			//console.log("From Renderer - updateAccount", data);
			for (const idx in this.accounts)
			{
				if (this.accounts[idx].id == data.id)
				{
					this.accounts[idx].name = data.name;
					this.store.set("accounts", this.accounts);
					break;
				}
			}
			
			this.instances[data.id].name = data.name;
			this.instances[data.id].view._name = data.name;
			
			for (const item of this.menuTemplate[0].submenu)
			{
				if (item.id == data.id)
				{
					item.label = data.name;
					break;
				}
			}
			
			this.menu = Menu.buildFromTemplate(this.menuTemplate);
			Menu.setApplicationMenu(this.menu);
			
			this.window.webContents.send(Constants.event.reloadAccounts);
		});
		
		ipcMain.on(Constants.event.deleteAccount, (event, id) => {
			//console.log("From Renderer - deleteAccount", id);
			let toDelete = null;
			for (let idx = 0; idx < this.accounts.length; idx++)
			{
				if (this.accounts[idx].id == id)
				{
					toDelete = idx;
					break;
				}
			}
			
			this.accounts.splice(toDelete, 1);
			this.store.set("accounts", this.accounts);
			
			delete this.instances[id];
			
			this.menuTemplate[0].submenu.splice(toDelete + 2, 1);
			for (let idx = 0; idx < this.menuTemplate[0].submenu.length; idx++)
			{
				if (this.menuTemplate[0].submenu[idx].type == "radio")
				{
					if (idx - 2 < 10)
						this.menuTemplate[0].submenu[idx].accelerator = `Alt+${idx-1}`;
						
					if (idx - 2 == 10)
						this.menuTemplate[0].submenu[idx].accelerator = `Alt+0`;
						
					if (idx - 2 > 10)
						delete this.menuTemplate[0].submenu[idx].accelerator;
				}
			}
			this.menu = Menu.buildFromTemplate(this.menuTemplate);
			Menu.setApplicationMenu(this.menu);
			
			// remove storage path
			const ses = session.fromPartition(`persist:${id}`);
			ses.clearStorageData().then(() => {
				const dir = ses.getStoragePath();
				fs.rmSync(dir, { recursive: true, force: true });
			});
			
			this.window.webContents.send(Constants.event.reloadAccounts);
		});
		
		ipcMain.on(Constants.event.gotoAccount, (event, id) => {
			//console.log("From Renderer - gotoAccount", id);
			this.setCurrentView(id);
		});

		// screen share
		ipcMain.handle(Constants.event.getShareSources, async () => {
			const sources = await desktopCapturer.getSources({types: ["screen", "window"], thumbnailSize: {width: 400, height: 400}});
			return sources.map(s => ({id: s.id, name: s.name, thumb: s.thumbnail.toDataURL()}));
		});

		ipcMain.on(Constants.event.setShareSelected, (event, id) => {
			desktopCapturer.getSources({types: ["screen", "window"]}).then((sources) => {
				for (const src of sources)
				{
					if (src.id == id)
						this.shareCurrent.callback({video: src, audio: "loopback"});
				}
				this.setCurrentView(this.shareCurrent.id);
				this.shareCurrent = null;
			});
		});

		ipcMain.on(Constants.event.setShareCancelled, () => {
			try {
				this.shareCurrent.callback({error: "cancelled by user"});
			} catch {}
			this.setCurrentView(this.shareCurrent.id);
			this.shareCurrent = null;
		});
	}

	quit() {
		if (this.isQuitting)
			return;

		this.isQuitting = true;
		const cacheClears = Object.entries(this.instances).map(([id, instance]) => {
			return instance.view.webContents.session.clearCache()
				.then(() => {
					console.log(`WhatsApp Electron: Cleared cache for instance "${instance.name} (${id})"`);
				})
				.catch((err) => {
					console.error(`WhatsApp Electron: Failed to clear cache for instance "${instance.name} (${id})":`, err);
				});
		});

		Promise.allSettled(cacheClears).then(() => app.quit());
	}

	createWindow() {
		const options = {
			width: this.bounds.width + Constants.offsets.window.width,
			height: this.bounds.height + Constants.offsets.window.height,
			icon: this.baseIcon,
			webSecurity: false,
			webPreferences: {
				preload: path.join(__dirname, "preload.js")
			},
			show: !process.argv.includes("--start-in-tray")
		};

		if (this.bounds.x != null)
		{
			options.x = this.bounds.x + Constants.offsets.window.x;
			options.y = this.bounds.y + Constants.offsets.window.y;
		}

		this.window = new BrowserWindow(options);
		//this.window.loadFile(!app.isPackaged ? "accounts.html" : "./src/accounts.html");
		this.window.loadFile("./src/accounts.html");

		this.window.webContents.send(Constants.event.initResources, {constants: Constants});

		if (this.spellLangs.length > 0)
			this.window.webContents.session.setSpellCheckerLanguages(this.spellLangs);

		this.window.on("move", () => { this.storeWindowBounds(); });
		this.window.on("resize", () => { this.storeWindowBounds(); });

		this.window.on("close", (e) => {
			if (this.isQuit)
			{
				//app.quit();
				this.quit();
				return;
			}

			e.preventDefault();
			this.closeCurrentChats();
			this.window.hide();
		});
		
		this.window.setTitle(`${Constants.appName} :: Accounts`);
		
		this.window.on("focus", () => {
			const views = this.window.contentView.children;
			if (views.length > 0)
				views[views.length - 1].webContents.focus();
		});
	}

	createView(id, name) {
		console.log(`WhatsApp Electron: Creating WebContentsView Instance for "${name} (${id})"`);
		this.instances[id] = {id: id, name: name, unread: 0, view: null};

		const view = new WebContentsView({
			webPreferences: {
				partition: `persist:${id}`,
				preload: path.join(__dirname, "whatsapp-preload.js"),
				spellcheck: true,
				contextIsolation: false
			}
		});
		this.instances[id].view = view;

		// spell check
		if (this.spellLangs.length > 0)
			view.webContents.session.setSpellCheckerLanguages(this.spellLangs);

		// screen share
		view.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
			desktopCapturer.getSources({types: ["screen", "window"]}).then((sources) => {
				this.shareCurrent = {id: id, callback: callback};
				this.removeViews();
				this.window.webContents.executeJavaScript(`showScreenShareModal('${id}');`);
			});
		}, {useSystemPicker: true});

		view._id   = id;
		view._name = name;

		view.setBackgroundColor('white');
		// set up window open handler
		view.webContents.setWindowOpenHandler((details) => {
			const url = new URL(details.url);
			if (url.hostname == "web.whatsapp.com" || url.hostname.endsWith(".whatsapp.com"))
			{
				return {
					action: "allow",
					overrideBrowserWindowOptions: {
						parent: this.window,
						show: true,
						frame: true
					}
				}
			}
			require('electron').shell.openExternal(details.url);
			return { action: 'deny' };
		});
		
		let tt = null;
		async function loadWhatsApp(timeout = 2500) {
			try {
				// init whatsapp instance after load finished
				view.webContents.on("did-finish-load", () => {
					console.log(`WhatsApp Electron: WebContentsView Instance for "${name} (${id})" has finished loading, initializing it...`);
					view.webContents.send(Constants.event.initWhatsAppInstance, {id: id, name: name, constants: Constants});
				});
				await Promise.race([
					view.webContents.loadURL(Constants.whatsapp.url, { userAgent: Constants.whatsapp.userAgent }),
					new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout))
				]);
			} catch (e) {
				console.error(e);
				view.webContents.removeAllListeners('did-finish-load');
				view.webContents.loadFile("./src/offline.html");
				tt = setTimeout(loadWhatsApp, 2500);
			}
		};
		loadWhatsApp();
		
		let menuItem = {
			id: id,
			label: name,
			type: "radio",
			checked: false,
			click: () => {
				this.setCurrentView(id);
			}
		};
		
		if (this.menuTemplate[0].submenu.length == 1)
			this.menuTemplate[0].submenu.push({type: "separator"});
		
		if (this.menuTemplate[0].submenu.length < (10 + 2))
		{
			const idx = this.menuTemplate[0].submenu.length - 1;
			if (idx < 10)
				menuItem.accelerator = `Alt+${idx}`;
			if (idx == 10)
				menuItem.accelerator = `Alt+0`;
		}
		this.menuTemplate[0].submenu.push(menuItem);
	}

	setCurrentViewByIdx(idx) {
		this.setCurrentView(this.accounts[idx].id);
	}

	setCurrentView(id) {
		//console.log("setCurrentView:", id);
		const instance = this.instances[id];

		this.window.setTitle(`${Constants.appName} :: ${instance.name}`);
		this.replaceView(instance.view);

		if (this.menu != undefined)
		{
			for (const menu of this.menu.items[0].submenu.items)
			{
				if (menu.type == "radio" && menu.id == id)
					menu.checked = true;
			}
		}

		this.setViewBounds(id);
		instance.view.webContents.focus();
	}

	setViewBounds(id, bounds = null) {
		bounds = bounds == null ? this.bounds : bounds;
		this.instances[id].view.setBounds({
			x: 0 + Constants.offsets.view.x, 
			y: 0 + Constants.offsets.view.y, 
			width: bounds.width + Constants.offsets.view.width, 
			height: bounds.height + Constants.offsets.view.height
		});
	}

	removeViews() {
		const views = this.window.contentView.children;
		for (const view of views)
			this.window.contentView.removeChildView(view);
	}
	replaceView(view) {
		this.removeViews();
		this.window.contentView.addChildView(view);
	}

	storeWindowBounds() {
		this.bounds = this.window.getBounds();
		this.store.set("bounds", this.bounds);

		for (const id in this.instances)
			this.setViewBounds(id);
	}

	updateTrayBadgeCounter() {
		let counter = 0;
		for (const id in this.instances)
			counter += this.instances[id].unread;

		if (counter == 0)
		{
			this.tray.setImage(this.baseIcon);
			return
		}

		this.window.webContents.send(Constants.event.buildBadgeIcon, counter);
	}

	showHide(hide = true) {
		if (!this.window.isFocused())
		{
			if (this.window.isVisible())
			{
				this.window.focus();
			}
			else if (this.window.isMinimized())
			{
				this.window.restore();
				this.window.focus();
			}
			else
			{
				this.window.show();
				this.window.restore();
				this.window.focus();
			}
		}
		else
		{
			if (hide)
			{
				this.closeCurrentChats();
				this.window.hide();
			}
		}
	}

	closeCurrentChats() {
		// send ESC key event to close current chats
		for (const id in this.instances) {
			this.instances[id].view.webContents.sendInputEvent({type: "keyDown", keyCode: "Escape"});
			this.instances[id].view.webContents.sendInputEvent({type: "keyUp", keyCode: "Escape"});
		}
	}
}

let Constants = {};
const ws      = new WhatsAppElectron();

app.whenReady().then(() => {
	Constants = require("./constants").init(app.getSystemLocale());
	ws.init();
});

app.on('second-instance', () => {
	ws.showHide(false);
});

app.on('window-all-closed', () => {
	if (ws.isQuit)
		ws.quit();
});
