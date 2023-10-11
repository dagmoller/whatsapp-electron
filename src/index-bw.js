
const AccountTemplate = `
<tr id="@ID">
  <th scope="row" class="font-monospace acct-link" style="cursor: pointer" title="Open Account">@ID</th>
  <td class="acct-name acct-link" style="cursor: pointer" title="Open Account">@NAME</td>
  <td>
    <button type="button" class="btn p-0 fs-5 mx-1 acct-edit" title="Edit Account" data-bs-toggle="modal" data-bs-target="#accountModal" data-bs-action="edit" data-bs-acct-id="@ID"><i class="bi bi-pencil-square"></i></button>
    <button type="button" class="btn p-0 fs-5 mx-1 acct-del" title="Delete Account" data-bs-toggle="modal" data-bs-target="#deleteModal" data-bs-acct-id="@ID"><i class="bi bi-person-x-fill"></i></button>
  </td>
</tr>`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const makeid = (length) => {
	let result = '';
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const charactersLength = characters.length;
	let counter = 0;
	while (counter < length) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
		counter += 1;
	}
	return result;
}

const init = async () => {
	while (window.electron == undefined)
		await sleep(1);

	const setAccounts = (accounts) => {
		$(".acct-list").empty();
		for (const account of accounts)
		{
			const acct = AccountTemplate.replaceAll("@ID", account.id).replaceAll("@NAME", account.name);
			$(".acct-list").append($(acct));
			
			$(`#${account.id} .acct-link`).on("click", () => {
				window.electron.gotoAccount(account.id);
			});
			
			$(`#${account.id} .acct-del`).on("click", () => {
				$("#acct-account-remove-name").html(account.name);
				$("#acct-delete-button").attr("data-bs-acct-id", account.id);
			});
		}
	}

	window.electron.getAccounts().then((accounts) => {
		setAccounts(accounts);
	});
	
	window.electron.reloadAccounts(() => {
		console.log("Reload Accounts");
		window.electron.getAccounts().then((accounts) => {
			setAccounts(accounts);
		});
	});
	
}
init();

$("#accountModal").on("show.bs.modal", (event) => {
	const button = event.relatedTarget;
	const action = button.getAttribute('data-bs-action');
	
	$("#acct-action").val(action);
	$(".invalid-feedback").hide();

	if (action == "new")
	{
		$("#acct-id").val("");
		$("#acct-name").val("");
		$("#accountModalLabel").html("Account (new)");
	}
	else
	{
		const acctid = button.getAttribute('data-bs-acct-id');
		const name   = $(`#${acctid} .acct-name`).html();

		$("#acct-id").val(acctid);
		$("#acct-name").val(name);
		$("#accountModalLabel").html("Account (change)");
	}
});
$("#accountModal").on("shown.bs.modal", (event) => {
	$("#acct-name").focus();
});

$(".acct-save").on("click", () => {
	$("#accountForm").submit();
});

$("#acct-delete-button").on("click", (event) => {
	const acctid = $("#acct-delete-button").attr('data-bs-acct-id');
	
	bootstrap.Modal.getInstance("#deleteModal").hide();
	window.electron.deleteAccount(acctid);
});

$("#accountForm").on("submit", (event) => {
	event.preventDefault();
	
	if ($("#acct-action").val() == "new")
	{
		if (!$("#acct-name").val().trim())
		{
			$(".invalid-feedback").show();
		}
		else
		{
			$(".invalid-feedback").hide();
			window.electron.addAccount(makeid(10), $("#acct-name").val().trim());
			bootstrap.Modal.getInstance("#accountModal").hide();
		}
	}
	
	if ($("#acct-action").val() == "edit")
	{
		if (!$("#acct-name").val().trim())
		{
			$(".invalid-feedback").show();
		}
		else
		{
			$(".invalid-feedback").hide();
			window.electron.updateAccount($("#acct-id").val(), $("#acct-name").val().trim());
			bootstrap.Modal.getInstance("#accountModal").hide();
		}
	}
});

