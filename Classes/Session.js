const crypto = require('crypto');
const Client = require("./Client.js");

class Session{
	constructor(newSessionInfo){
		this.sessionID = newSessionInfo.sessionID;
		this.expiryDate = newSessionInfo.expiryDate;
		this.clientList = [];
		this.validEndpoints = newSessionInfo.validEndpoints;
		this.sessionData = newSessionInfo.sessionData;
	}

	/* Add a client to the clientList */
	addClient(newClientData){
		let newClient = new Client({
			clientID: crypto.randomFillSync(Buffer.alloc(32), 0, 32).toString('hex'),
			clientClass: newClientData.clientClass,
			clientData: newClientData.clientData,
		});

		this.clientList.push(newClient);

		let clientCookieObj = {
			sessionID: this.sessionID,
			clientID: newClient.clientID,
		};

		return JSON.stringify(clientCookieObj);
	}

	/* Delete a client */
	removeClient(clientID){
		let matchingClients = this.clientList.filter((c)=>{
			return c.clientID === clientID;
		});
		if(matchingClients.length > 0){
			//Delete 1 object at the index of the client
			clientList.splice(clientList.indexOf(matchingClients[0]),1);
			delete matchingClients[0];	//Delete the reference to the object
		}
	}

	/* Process a request originating from a host with a valid MDSM cookie matching this session */
	processRequest(req,res,mdsmCookie,next){
		let client = this.clientList.filter((c)=>{
			return c.clientID === JSON.parse(mdsmCookie).clientID;
		})[0];

		let endpoint = this.validEndpoints.filter((ep)=>{
			return ep.url === this.trimURL(req.url);
		})[0];

		if(endpoint.allowedClassTypes.includes(client.clientClass)){
			endpoint.handler(this.sessionData,client.clientData,req,res,mdsmCookie);
		}

		res.end(`Your session is ${this.sessionID}. Your MDSM cookie is ${mdsmCookie}`);
	}

	/* Extends the life of the current session by a specified number of milliseconds.
	 * The selfDstruct function will verify that the current time is greater than them
	 * expiry date before deleting the session. */
	extendSessionLife(additionalLifeMs){
		this.expiryDate += additionalLifeMs;
	}

	/* Destroys the current session, but only if the expiry date is in the past. */
	attemptSelfDestruct(){
		/* Get the difference in ms between expiry date and the current time */
		let true_ttl = this.expiryDate - Date.now();

		/* If the ttl is not positive (meaning the expiry date is smaller than the
		 * current date), delete the session. */
		if(true_ttl <= 0){
			delete this;	// Delete the Session object
			return true;	// Signal that the deletion was successful
		}

		/* Otherwise, return false to indicate that the session should not be deleted yet */
		else return false;
	}

	/* If the URL starts or begins with slashes, trims it to remove them. */
	trimURL(url){
		let trimmedUrl = url;
		if(trimmedUrl.charAt(0) === '/'){
			trimmedUrl = trimmedUrl.substring(1,trimmedUrl.length);
		}
		if(trimmedUrl.charAt(trimmedUrl.length - 1) === '/'){
			trimmedUrl = trimmedUrl.substring(0,trimmedUrl.length - 1);
		}
		return trimmedUrl;
	}
}

module.exports = Session;
