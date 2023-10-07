const { app, BrowserWindow, BrowserView, ipcMain, Menu, Tray, nativeImage, Notification } = require('electron')
const Store = require('electron-store');
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const path = require('node:path')
const isDev = require('electron-is-dev')

const store = new Store();

const baseIcon = isDev ? path.join(__dirname, "../assets/whatsapp-icon-512x512.png") : path.join(process.resourcesPath, "app.asar.unpacked/assets/whatsapp-icon-512x512.png");
let   baseIconImage = null;

let window;
let tray;
let isQuit = false;

let bounds = store.get("bounds");
if (bounds == undefined)
	bounds = {width: 1024, height: 768, x: null, y: null};

let accounts = store.get("accounts");
if (accounts == undefined)
{
	accounts = [{id: "default", name: "Default Account"}];
	store.set("accounts", accounts);
}

let instances = {};
for (const acc of accounts)
	instances[acc.id] = {name: acc.name, unread: 0, view: null};

const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) {
	app.quit();
	return;
}

const createWindow = () => {
	changeInstance = (id) => {
		//console.log("Change BrowserView Instance:", id, instances[id].name);
		currentInstance = id;
		window.setTopBrowserView(instances[id].view);
		window.setTitle(`WhatsApp :: ${instances[id].name}`);
	}

	ipcMain.on("update-unread-messages", (event, data) => {
		//console.log("Unread Messages: ", data);
		instances[data.id].unread = data.unread;
		updateTrayCounter();
	});

	ipcMain.on("new-renderer-notification", (event, data) => {
		//console.log("New Renderer Notification...", data);
		const n = new Notification({
			title: `[${instances[data.id].name}] :: ${data.title}`,
			body:  data.options.body,
			icon: nativeImage.createFromDataURL(data.icon)
		});
		n.on("click", (event) => {
			//console.log("Notification Clicked...", data.id, data.options.tag);
			showHideApp(false);
			changeInstance(data.id);
			instances[data.id].view.webContents.send("fire-notification-click", data.options.tag);
		});
		n.show();
	})

	const options = {
		width: bounds.width,
		height: bounds.height,
		icon: baseIcon
	};
	if (bounds.x != null)
	{
		options.x = bounds.x;
		options.y = bounds.y - 28;
	}
	window = new BrowserWindow(options);

	let menuItens       = [{label: "Accounts", enabled: false}, {type: "separator"}];
	let isFirst         = true;
	let currentInstance = null;
	for (const id in instances)
	{
		const view = new BrowserView({
			webPreferences: {
				partition: `persist:${id}`,
				contextIsolation: false,
				preload: path.join(__dirname, "preload.js"),
				spellcheck: true
			}
		});
		window.addBrowserView(view);
		instances[id].view = view;

		setTimeout(() => {
			view.setBounds({x: 0, y: 0, width: bounds.width, height: bounds.height - 30});
		}, 1000);

		view.setBackgroundColor('white');
		view.webContents.loadURL('https://web.whatsapp.com/', { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36" });
		view.webContents.setWindowOpenHandler((details) => {
			require('electron').shell.openExternal(details.url);
			return { action: 'deny' };
		});

		view.webContents.send("set-instance", {id: id, name: instances[id].name});

		const menuItem = {
			label: instances[id].name,
			type: "radio",
			checked: isFirst,
			click() {
				changeInstance(id);
			}
		};
		menuItens.push(menuItem);

		isFirst = false;
	}
	changeInstance(Object.keys(instances)[0]);

	// Add Help to Menu
	const appMenu = [
		{
			label: "WhatsApp",
			submenu: menuItens
		},
		{
			label: 'Help',
			submenu:
			[
				{
					label: 'Open Development Tool',
					click() {
						instances[currentInstance].view.webContents.openDevTools();
					}
				},
				{
					label: "Force Reload (instance)",
					click() {
						instances[currentInstance].view.webContents.reload();
						setTimeout(() => {
							instances[currentInstance].view.webContents.send("set-instance", {id: currentInstance, name: instances[currentInstance].name});
						}, 1000);
					}
				},
				{ type: 'separator' },
				{
					label: "Quit",
					click() {
						isQuit = true;
						app.quit();
					}
				}
			]
		}
	]
	Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu));

	saveBounds = () => {
		bounds = window.getBounds();
		store.set("bounds", bounds);
	}

	window.on("move", saveBounds);
	window.on("resize", () => {
		saveBounds();
		for (const id in instances)
			instances[id].view.setBounds({x: 0, y: 0, width: bounds.width, height: bounds.height - 28});
	});

	window.on("close", (event) => {
		if (isQuit)
		{
			app.quit();
			return;
		}
		event.preventDefault();
		window.hide();
	})
}

const showHideApp = (hide = true) => {
	//console.log("Show/Hide Clicked");
	//console.log("Window isVisible: ", window.isVisible());

	if (!window.isFocused())
	{
		if (window.isVisible())
		{
			window.focus();
		}
		else
		if (window.isMinimized())
		{
			window.restore();
			window.focus();
		}
		else
		{
			window.show();
			window.restore();
			window.focus();
		}
	}
	else
	{
		if (hide)
			window.hide();
	}
}

const createTrayIcon = async () => {
	const menu = Menu.buildFromTemplate([
		{label: "Show/Hide", click: showHideApp},
		{type: "separator"},
		{label: "Quit", click: () => { isQuit = true; app.quit(); }}
	]);
	tray = new Tray(baseIcon);
	tray.setContextMenu(menu);
	tray.setToolTip("WhatsApp Electron");

	tray.on("click", (event) => {
		showHideApp();
	});
}

const updateTrayCounter = async () => {
	let counter = 0;
	for (const name in instances)
		counter += instances[name].unread;

	if (counter == 0)
	{
		tray.setImage(baseIcon);
		return
	}

	loadImage(baseIcon).then(image => {
		const canvas = createCanvas(image.width, image.height)
		const ctx = canvas.getContext('2d')

		ctx.drawImage(image, 0, 0, image.width, image.height)

		var centerX = canvas.width / 2;
		var centerY = canvas.height / 2;
		centerX = centerX + (centerX / 2) - 2;
		centerY = centerY - (centerY / 2) + 2;
		var radius = 128;

		ctx.beginPath();
		ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
		ctx.fillStyle = '#ff3333';
		ctx.fill();
		ctx.lineWidth = 2;
		ctx.strokeStyle = '#003300';
		ctx.stroke();

		ctx.font = 'bold 200px DejaVu Sans Mono';
		ctx.fillStyle = '#ffffff';
		ctx.fillText(String(counter), centerX - (counter >= 10 ? 115 : 60), centerY + 70);

		tray.setImage(nativeImage.createFromBuffer(canvas.toBuffer('image/png')));
	})
}

app.whenReady().then(() => {
	createTrayIcon();
	createWindow();
});

app.on('second-instance', () => {
	if (window) {
		showHideApp(false);
	}
});

app.on('window-all-closed', () => app.quit());
