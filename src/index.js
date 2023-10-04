const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron')
const Store = require('electron-store');
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const path = require('node:path')
const isDev = require('electron-is-dev');

const store = new Store();

const baseIcon = isDev ? path.join(__dirname, "../assets/whatsapp-icon-512x512.png") : path.join(process.resourcesPath, "app.asar.unpacked/assets/whatsapp-icon-512x512.png");
let   baseIconImage = null;

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
			preload: path.join(__dirname, "preload.js"),
			spellcheck: true
		},
		autoHideMenuBar: true,
		icon: baseIcon
	}
	if (bounds.x != null)
	{
		options.x = bounds.x;
		options.y = bounds.y - 28;
	}

	window = new BrowserWindow(options);

	ipcMain.on("update-unread-messages", (event, unread) => {
		console.log("Unread Messages: ", unread);
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

const updateTrayCounter = async (counter) => {
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
