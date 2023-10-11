const { app, BrowserWindow, BrowserView, ipcMain, Menu, Tray, nativeImage, Notification, MenuItem, session } = require('electron');
const Store = require('electron-store');
const path  = require('node:path');
const isDev = require('electron-is-dev');

// Single Electron Instance
if (!app.requestSingleInstanceLock()) {
	app.quit();
	return;
}

class WhatsAppElectron
{
	constructor() {
		this.store    = new Store();
		this.baseIcon = isDev ? path.join(__dirname, "../assets/whatsapp-icon-512x512.png") : path.join(process.resourcesPath, "app.asar.unpacked/assets/whatsapp-icon-512x512.png");
		this.isQuit   = false;

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
							const view = this.window.getBrowserView();
							if (view != null)
								this.window.removeBrowserView(view);
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
						label: 'Open Development Tool',
						click: () => {
							const bv = this.window.getBrowserView();
							if (bv != null)
								bv.webContents.openDevTools();
							else
								this.window.webContents.openDevTools();
						}
					},
					{
						label: "Force Reload (instance)",
						click: () => {
							const bv = this.window.getBrowserView();
							if (bv != null)
							{
								bv.webContents.reload();
								//bv.webContents.loadURL(Constants.whatsapp.url, { userAgent: Constants.whatsapp.userAgent });
								setTimeout(() => {
									bv.webContents.send(Constants.event.initWhatsAppInstance, {id: bv._id, name: bv._name, constants: Constants});
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
							app.quit();
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
		
		this.createWindow();

		for (const item of this.accounts)
			this.createView(item.id, item.name);

		this.menu = Menu.buildFromTemplate(this.menuTemplate);
		Menu.setApplicationMenu(this.menu);

		if (this.accounts.length > 0)
			this.setCurrentViewByIdx(0);

		const menu = Menu.buildFromTemplate([
			{label: "Show/Hide", click: () => { this.showHide(); }},
			{type: "separator"},
			{label: "Quit", click: () => { this.isQuit = true; app.quit(); }}
		]);

		this.tray = new Tray(this.baseIcon);
		this.tray.setContextMenu(menu);
		this.tray.setToolTip(Constants.appName);
		this.tray.on("click", () => { this.showHide(); });

		// Events
		ipcMain.on(Constants.event.newRendererNotification, (event, data) => {
			//console.log("New Renderer Notification...", data);
			const n = new Notification({
				title: `[${this.instances[data.id].name}] :: ${data.title}`,
				body: data.options.body,
				icon: nativeImage.createFromDataURL(data.icon)
			});
			n.on("click", (event) => {
				//console.log("Notification Clicked...", data.id, data.options.tag);
				this.showHide(false);
				this.setCurrentView(data.id);
				this.instances[data.id].view.webContents.send(Constants.event.fireNotificationClick, data.options.tag);
			});
			n.show();
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
			const bv = this.instances[id].view;
			bv.webContents.reload();
			setTimeout(() => {
				bv.webContents.send(Constants.event.initWhatsAppInstance, {id: bv._id, name: bv._name, constants: Constants});
			}, 1000);
		});
		ipcMain.on(Constants.event.clearWorkersAndReload, (envet, id) => {
			const ses = session.fromPartition(`partition:${id}`);
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
			
			this.window.webContents.send(Constants.event.reloadAccounts);
		});
		
		ipcMain.on(Constants.event.gotoAccount, (event, id) => {
			//console.log("From Renderer - gotoAccount", id);
			this.setCurrentView(id);
		});
	}

	createWindow() {
		const options = {
			width: this.bounds.width,
			height: this.bounds.height,
			icon: this.baseIcon,
			webSecurity: false,
			webPreferences: {
				preload: path.join(__dirname, "preload-bw.js")
			}
		};

		if (this.bounds.x != null)
		{
			options.x = this.bounds.x + Constants.offsets.linux.x;
			options.y = this.bounds.y + Constants.offsets.linux.y;
		}

		this.window = new BrowserWindow(options);
		this.window.loadFile(isDev ? "index-bw.html" : "./src/index-bw.html");

		this.window.webContents.send(Constants.event.initResources, {constants: Constants});

		this.window.on("move", () => { this.storeWindowBounds(); });
		this.window.on("resize", () => { this.storeWindowBounds(); });

		this.window.on("close", (e) => {
			if (this.isQuit)
			{
				app.quit();
				return;
			}

			e.preventDefault();
			this.window.hide();
		});
		
		this.window.setTitle(`${Constants.appName} :: Accounts`);
	}

	createView(id, name) {
		this.instances[id] = {id: id, name: name, unread: 0, view: null};

		const view = new BrowserView({
			webPreferences: {
				partition: `persist:${id}`,
				preload: path.join(__dirname, "preload-bv.js"),
				spellcheck: true,
				contextIsolation: false
			}
		});
		this.instances[id].view = view;

		view._id   = id;
		view._name = name;

		view.setBackgroundColor('white');
		view.webContents.loadURL(Constants.whatsapp.url, { userAgent: Constants.whatsapp.userAgent });
		view.webContents.setWindowOpenHandler((details) => {
			require('electron').shell.openExternal(details.url);
			return { action: 'deny' };
		});
		view.webContents.send(Constants.event.initWhatsAppInstance, {id: id, name: name, constants: Constants});

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
		this.window.setBrowserView(instance.view);

		if (this.menu != undefined)
		{
			for (const menu of this.menu.items[0].submenu.items)
			{
				if (menu.type == "radio" && menu.id == id)
					menu.checked = true;
			}
		}

		this.setViewBounds(id);
	}

	setViewBounds(id, bounds = null) {
		bounds = bounds == null ? this.bounds : bounds;
		let woffset = 0;  // Linux
		let hoffset = 25; // Linux
		if (process.platform == "win32")
		{
			woffset = 15;
			hoffset = 60;
		}

		this.instances[id].view.setBounds({x: 0, y: 0, width: bounds.width - woffset, height: bounds.height - hoffset});
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
				this.window.hide();
			}
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
	app.quit()
});
