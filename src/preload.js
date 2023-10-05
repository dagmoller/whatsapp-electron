const { ipcRenderer } = require('electron')

// Helper
let lastUnread = 0;

// ModuleRaid
window.mId  = Math.random().toString(36).substring(7);
window.mObj = {}
let loadModuleRaid = () => {
	window.webpackChunkwhatsapp_web_client.push([
		[window.mID], {}, function (e) {
			Object.keys(e.m).forEach(function(mod) {
				window.mObj[mod] = e(mod);
			})
		}
	])
}
window.mRFindModule = (query) => {
	let results = [];
	let modules = Object.keys(window.mObj);

	modules.forEach(function(mKey) {
		var mod = window.mObj[mKey];

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
			else
			{
				throw new TypeError('findModule can only find via string and function, ' + (typeof query) + ' was passed');
			}
		}
	})

	return results;
}

// Notification Wrapper
class NotificationWrapper extends Notification {
	constructor(title, options) {
		//console.log("NotificationWrapper Called...", title, options);
		options.icon = options.icon.replace("https://web.whatsapp.com/", "").replace("%3F", "?");
		super(title, options);

		setTimeout(() => {
			NotificationWrapper.__countUnread();
		}, 1000);

		this.addEventListener("click", (event) => {
			//console.log("NotificationWrapper Clicked...");
			ipcRenderer.send("notification-clicked", null);
		});
	}

	static __countUnread() {
		try {
			var unread  = 0;
			const itens = document.getElementsByTagName("span");
			for (const item of itens)
			{
				if (item.hasAttributes())
				{
					for (const attr of item.attributes)
					{
						if (attr.name == "aria-label" && attr.value == "Não lidas")
							unread += parseInt(item.innerText);
					}
				}
			}

			if (unread != lastUnread)
			{
				//console.log("Unread Messages: ", unread);
				lastUnread = unread;
				ipcRenderer.send("update-unread-messages", unread);
			}
		} catch (e) {
			console.error(e)
		}
	}

	show(...data) {
		console.log("show", data);
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
		options.icon = options.icon.replace("https://web.whatsapp.com/", "").replace("%3F", "?");
		const serverNotification = JSON.parse(JSON.stringify({
			title: title,
			options: options,
			icon: await this._getIcon(options.icon)
		}));
		ipcRenderer.send("new-renderer-notification", serverNotification);
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

const openChat = async (tag) => {
	let chatWid = window.mRFindModule('createWid')[0].createWid(tag);
	let chat    = await window.mRFindModule(m => m.default && m.default.Chat)[0].default.Chat.find(chatWid);
	await window.mRFindModule("Cmd")[0].Cmd.openChatAt(chat);
}
ipcRenderer.on("fire-notification-click", (event, tag) => {
	//console.log("Received Notification Click from Main...", tag);
	openChat(tag);
});

// Mutation Observer
let mrControl = false;
let observer = new MutationObserver((mutations) => {
	mutations.forEach(function(mutation) {
		NotificationWrapper.__countUnread();

		if (!mrControl && mutation.target.ariaLabel == "foto do perfil")
		{
			console.log("Loading Module Raid...")
			mrControl = true;
			loadModuleRaid();
		}
	});
});

setTimeout(() => {
	console.log("Starting Mutation Observer...");
	observer.observe(document.body, {
 		characterData: true,
		childList: true,
 		subtree: true,
	});
}, 3000);

window.oldNotification = Notification;
//window.Notification = NotificationWrapper;
window.Notification = NotificationServer;
console.log("Notifications Object Changed to NotificationWrapper...");
