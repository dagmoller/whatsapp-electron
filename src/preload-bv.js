 
const { ipcRenderer } = require('electron');

class WhatsAppInstance
{
	constructor(id, name) {
		// self
		this.id         = id;
		this.name       = name;
		this.lastUnread = 0;

		// Module Raid
		this.mrid  = null;
		this.mrobj = {};

		// Notification Wrapper
		window.oldNotification = Notification;
		window.Notification = NotificationServer;
		console.log("Window Notifications Object Replaced by NotificationServer...");

		// Mutation Oberver
		this.observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				this.countUnread();

				if (this.mrctl == null && mutation.target.ariaLabel == Constants.whatsapp.profilePicture)
					this.loadModuleRaid();
			});
		});

		setTimeout(() => {
			console.log("Starting Mutation Observer...");
			this.observer.observe(document.body, {
				characterData: true,
				childList: true,
				subtree: true,
			});
		}, 1000);

		// Events
		ipcRenderer.on(Constants.event.fireNotificationClick, (event, tag) => {
			//console.log("Received Notification Click from Main...", tag);
			this.openChat(tag);
		});
	}

	getId() {
		return this.id;
	}

	loadModuleRaid() {
		console.log("Loading Module Raid...");
		this.mrctl = Math.random().toString(36).substring(7);
		window.webpackChunkwhatsapp_web_client.push([
			[this.mrid], {}, (e) => {
				Object.keys(e.m).forEach((mod) => {
					this.mrobj[mod] = e(mod);
				})
			}
		]);
	}

	findModule(query) {
		let results = [];
		let modules = Object.keys(this.mrobj);
		modules.forEach((mKey) => {
			let mod = this.mrobj[mKey];
			if (typeof mod !== 'undefined') {
				if (typeof query === 'string') {
					if (typeof mod.default === 'object') {
						for (const key in mod.default) {
							if (key == query) results.push(mod);
						}
					}
					for (const key in mod) {
						if (key == query) results.push(mod);
					}
				}
				else if (typeof query === 'function') {
					if (query(mod)) {
						results.push(mod);
					}
				}
				else {
					throw new TypeError('findModule can only find via string and function, ' + (typeof query) + ' was passed');
				}
			}
		});
		return results;
	}

	async openChat (tag) {
		let chatWid = this.findModule('createWid')[0].createWid(tag);
		let chat    = await this.findModule(m => m.default && m.default.Chat)[0].default.Chat.find(chatWid);
		await this.findModule("Cmd")[0].Cmd.openChatAt(chat);
	}

	countUnread() {
		let unread  = 0;
		const itens = document.getElementsByTagName("span");
		for (const item of itens)
		{
			if (item.hasAttributes())
			{
				for (const attr of item.attributes)
				{
					if (attr.name == "aria-label" && attr.value == Constants.whatsapp.unreadText)
						unread += parseInt(item.innerText);
				}
			}
		}

		if (this.lastUnread != unread)
		{
			this.lastUnread = unread;
			ipcRenderer.send(Constants.event.updateUnreadMessages, {id: this.id, unread: unread});
		}
	}
}

class NotificationServer
{
	constructor(title, options)
	{
		//console.log("New NotificationServer...", title, options);
		this._processOptions(title, options);
	}

	async _processOptions(title, options)
	{
		options.icon = options.icon.replace(Constants.whatsapp.url, "").replace("%3F", "?");
		const serverNotification = JSON.parse(JSON.stringify({
            id: wa.getId(),
			title: title,
			options: options,
			icon: await this._getIcon(options.icon)
		}));
		ipcRenderer.send(Constants.event.newRendererNotification, serverNotification);
	}

	_getIcon(icon)
	{
		if (!icon)
			return;

		return new Promise((resolve, reject) => {
			fetch(icon)
				.then((r) => r.blob())
				.catch(reject)
				.then((blob) => {
					const reader = new FileReader();
					reader.onload = (event) => resolve(event.target.result);
					reader.readAsDataURL(blob);
				});
		});
	}

	// wrapper compatibility
	static permission = 'granted';
	static maxActions = 3;
	static requestPermission(callback) {
		return new Promise((resolve, reject) => {
			if(typeof callback === 'function') {
				callback('granted');
			}
			resolve('granted');
		});
	}

	close() {}
}

// Events
let Constants = {};
let wa        = null;

ipcRenderer.on("init-whatsapp-instance", (event, data) => {
	console.log(`BrowserView ID: ${data.id} / Name: ${data.name}`);
	Constants = data.constants;
	wa = new WhatsAppInstance(data.id, data.name);
});
