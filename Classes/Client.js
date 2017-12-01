class Client{
	constructor(newClientInfo){
		this.clientID = newClientInfo.clientID;
		this.clientClass = newClientInfo.clientClass;
		this.clientData = newClientInfo.clientData;
	}
}

module.exports = Client;
