const { ipcRenderer } = require('electron')

// Helper
let lastUnread = 0;

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
}

// Mutation Observer
let observer = new MutationObserver((mutations) => {
	 mutations.forEach(function(mutation) {
		NotificationWrapper.__countUnread();
	});
});
setTimeout(() => {
	console.log("Starting Mutation Observer...");
	observer.observe(document.body, {
 		characterData: true,
		childList: true,
 		subtree: true,
	});
}, 10000);

window.oldNotification = Notification;
window.Notification = NotificationWrapper;
console.log("Notifications Object Changed to NotificationWrapper...");
