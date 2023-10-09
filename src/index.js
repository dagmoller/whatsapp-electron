const { app, BrowserWindow, BrowserView, ipcMain, Menu, Tray, nativeImage, Notification } = require('electron');
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

		this.accounts = this.store.get("accounts");
		if (this.accounts == undefined)
		{
			this.accounts = [{id: "default", name: "Default Account"}];
			this.store.set("accounts", this.accounts);
		}

		this.instances = {};
		for (const acct of this.accounts)
			this.instances[acct.id] = {id: acct.id, name: acct.name, unread: 0, view: null};

		this.menuTemplate = [
			{
				label: "WhatsApp",
				submenu: [
					{
						label: "Accounts",
						enabled: true,
						click: () => {
							this.window.removeBrowserView(this.window.getBrowserView());
						}
					},
					{type: "separator"}
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
								setTimeout(() => {
									bv.webContents.send(Constants.event.initWhatsAppInstance, {id: bv._id, name: bv._name, constants: Constants});
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

	init() {
		this.createWindow();

		for (const id in this.instances)
			this.createView(id);

		this.setCurrentViewByIdx(0);

		this.menu = Menu.buildFromTemplate(this.menuTemplate);
		Menu.setApplicationMenu(this.menu);

		const menu = Menu.buildFromTemplate([
			{label: "Show/Hide", click: () => { this.showHide(); }},
			{type: "separator"},
			{label: "Quit", click: () => { this.isQuit = true; app.quit(); }}
		]);

		this.tray = new Tray(this.baseIcon);
		this.tray.setContextMenu(menu);
		this.tray.setToolTip("WhatsApp Electron");
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
	}

	createWindow() {
		const options = {
			width: this.bounds.width,
			height: this.bounds.height,
			icon: this.baseIcon,
			webSecurity: false,
			webPreferences: {
				preload: path.join(__dirname, "preload-bw.js"),
			}
		};

		if (this.bounds.x != null)
		{
			options.x = this.bounds.x;
			options.y = this.bounds.y - 28;
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
	}

	createView(id) {
		const name = this.instances[id].name;
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

		this.menuTemplate[0].submenu.push({
			id: id,
			label: name,
			type: "radio",
			checked: false,
			//icon: this.baseIcon,
			click: () => {
				this.setCurrentView(id);
			}
		});
	}

	setCurrentViewByIdx(idx) {
		this.setCurrentView(this.accounts[idx].id);
	}

	setCurrentView(id) {
		//console.log("setCurrentView:", id);
		const instance = this.instances[id];

		this.window.setTitle(`WhatsApp :: ${instance.name}`);
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
	if (process.platform == "win32")
		app.setAppUserModelId("WhatsApp Electron");

	Constants = require("./constants").init(app.getSystemLocale());
	ws.init();
});

app.on('second-instance', () => {
	ws.showHide(false);
});

app.on('window-all-closed', () => {
	app.quit()
});
