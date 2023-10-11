
Constants = {
	appName : "WhatsApp Electron",
	offsets : {
		window: { x: 0, y: -29, width: 0, height: 0 }, // Linux
		view: { x: 0, y: 0, width: 0, height: -25 }     // Linux
	},
	event   : {},
	whatsapp: {}
};

Constants.whatsapp.url       = "https://web.whatsapp.com/";
Constants.whatsapp.userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36";

Constants.event.initResources           = "init-resources";
Constants.event.initWhatsAppInstance    = "init-whatsapp-instance";
Constants.event.clearWorkersAndReload   = "clear-workers-and-reload";
Constants.event.reloadWhatsAppInstance  = "reload-whatsapp-instance";
Constants.event.updateUnreadMessages    = "update-unread-messages";
Constants.event.newRendererNotification = "new-renderer-notification";
Constants.event.fireNotificationClick   = "fire-notification-click";
Constants.event.buildBadgeIcon          = "build-badge-icon";
Constants.event.updateBadgeIcon         = "set-updated-badge-icon";

Constants.event.getAccountsList         = "get-accounts-list";
Constants.event.addAccount              = "add-account";
Constants.event.updateAccount           = "update-account";
Constants.event.deleteAccount           = "delete-account";
Constants.event.gotoAccount             = "goto-account";
Constants.event.reloadAccounts          = "reload-accounts";

const init = (lang) => {
	switch (lang) {
		case "pt-BR":
			Constants.whatsapp.profilePicture = "foto do perfil";
			Constants.whatsapp.unreadText     = "Não lidas";
			break;
	}
	
	switch (process.platform) {
		case "win32":
			Constants.offsets.window.y   = -30;
			Constants.offset.view.width  = -15;
			Constants.offset.view.height = -60;
	}

	return Constants;
};

module.exports = { init };
