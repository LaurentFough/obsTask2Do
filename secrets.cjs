'use strict';
/**= Version 0.8.0-alpha.2. Portable password-encrypted credential vault; key never saved. */
class PasswordCredentialVault {
  constructor(key,salt){this.key=key;this.salt=salt;}
  static async open(passphrase,envelope=null){
    if(typeof passphrase!=='string'||passphrase.length<12)throw new Error('Use a master passphrase of at least 12 characters.');const crypto=require('node:crypto');
    if(envelope&&(envelope.schemaVersion!==1||envelope.cipher!=='aes-256-gcm'||envelope.iterations!==310000))throw new Error('Unsupported credential vault format.');
    const salt=envelope?Buffer.from(envelope.salt,'base64'):crypto.randomBytes(32);if(salt.length!==32)throw new Error('Invalid credential vault salt.');
    const key=await new Promise((resolve,reject)=>crypto.pbkdf2(passphrase,salt,310000,32,'sha256',(error,value)=>error?reject(error):resolve(value)));const vault=new PasswordCredentialVault(key,salt);let secrets={};
    if(envelope)try{secrets=vault.decrypt(envelope);}catch{vault.dispose();throw new Error('Wrong master passphrase or damaged credential vault.');}return{vault,secrets};
  }
  encrypt(secrets){if(!this.key)throw new Error('Credential vault locked.');const crypto=require('node:crypto'),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from('Task2Do credentials v1'));const data=Buffer.concat([cipher.update(JSON.stringify(secrets),'utf8'),cipher.final()]);return{schemaVersion:1,cipher:'aes-256-gcm',iterations:310000,salt:this.salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}
  decrypt(envelope){if(!this.key)throw new Error('Credential vault locked.');const crypto=require('node:crypto'),iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');if(iv.length!==12||tag.length!==16)throw new Error('Invalid credential envelope.');const decipher=crypto.createDecipheriv('aes-256-gcm',this.key,iv);decipher.setAAD(Buffer.from('Task2Do credentials v1'));decipher.setAuthTag(tag);const value=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));if(!value||typeof value!=='object')throw new Error('Invalid credential payload.');return value;}
  dispose(){this.key?.fill(0);this.key=null;}
}
function credentialSnapshot(settings){const publicSettings=JSON.parse(JSON.stringify(settings)),secrets={};if(publicSettings.savedCredentials){secrets.savedCredentials=publicSettings.savedCredentials;delete publicSettings.savedCredentials;}if(publicSettings.microsoft?.tokens){secrets.microsoftTokens=publicSettings.microsoft.tokens;delete publicSettings.microsoft.tokens;}for(const id of ['openproject','moovila'])if(publicSettings[id]?.token){secrets[id]=publicSettings[id].token;delete publicSettings[id].token;}return{publicSettings,secrets};}
module.exports={PasswordCredentialVault,credentialSnapshot};
