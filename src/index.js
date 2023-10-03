const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron')
const Store = require('electron-store');
const sharp = require('sharp')
const path = require('node:path')
const isDev = require('electron-is-dev');

const store = new Store();

const baseIcon = isDev ? path.join(__dirname, "../assets/whatsapp-icon-512x512.svg") : path.join(process.resourcesPath, "app.asar.unpacked/assets/whatsapp-icon-512x512.svg");

let window;
let tray;
let isQuit = false;

let bounds = store.get("bounds");
if (bounds == undefined)
	bounds = {width: 1024, height: 768, x: null, y: null};

const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) {
	app.quit();
	return;
}

const createWindow = () => {
	const options = {
		width: bounds.width,
		height: bounds.height,
		webPreferences: {
			contextIsolation: false,
			preload: path.join(__dirname, "preload.js")
		},
		autoHideMenuBar: true
	}
	if (bounds.x != null)
	{
		options.x = bounds.x;
		options.y = bounds.y - 28;
	}

	window = new BrowserWindow(options);

	ipcMain.on("update-unread-messages", (event, unread) => {
		//console.log("Unread Messages: ", unread);
		updateTrayCounter(unread);
	})

	ipcMain.on("notification-clicked", (event, data) => {
		showHideApp(false);
	})

	saveBounds = () => {
		bounds = window.getBounds();
		store.set("bounds", bounds);
	}

	window.on("move", saveBounds);
	window.on("resize", saveBounds);

	window.on("close", (event) => {
		if (isQuit)
		{
			app.quit();
			return;
		}
		event.preventDefault();
		window.hide();
	})

	window.loadURL('https://web.whatsapp.com/', { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36" });
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
	const icon = await sharp(baseIcon).png().resize(128,128).toBuffer();
	const menu = Menu.buildFromTemplate([
		{label: "Show/Hide", click: showHideApp},
		{type: "separator"},
		{label: "Quit", click: () => { isQuit = true; app.quit(); }}
	]);
	tray = new Tray(nativeImage.createFromBuffer(icon));
	tray.setContextMenu(menu);
	tray.setToolTip("WhatsApp Electron");

	tray.on("click", (event) => {
		showHideApp();
	});

	window.setIcon(nativeImage.createFromBuffer(icon));
}

const updateTrayCounter = async (counter) => {
	let   icon  = null;
	const fsize = counter >= 10 ? "4.5" : "5";
	const text  = `
	<svg width="128" height="128" viewBox="0 0 128 128">
		<circle cx="70%" cy="30%" r="38" stroke="black" stroke-width="1" fill="#f33" />
		<text x="70%" y="30%" text-anchor="middle" dy="0.35em" fill="#fff" font-size='${fsize}em' font-family="Arial" font-weight="bold">${counter}</text>
	</svg>
	`;

	if (counter > 0)
	{
		icon = await sharp(baseIcon)
			.composite([{input: Buffer.from(text), top: 0, left: 0, blend: 'over'}]).png().resize(128, 128).toBuffer();
	}
	else
	{
		icon = await sharp(baseIcon).png().resize(128, 128).toBuffer();
	}
	tray.setImage(nativeImage.createFromBuffer(icon));
}

app.whenReady().then(() => {
	createWindow();
	createTrayIcon();
});

app.on('second-instance', () => {
	if (window) {
		showHideApp(false);
	}
});

app.on('window-all-closed', () => app.quit());
