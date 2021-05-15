const express = require('express')
const app = express()
const port = 3000
const Web3 = require("web3")
const utils = require("./utils.js")
const chainInfo = require("./chain_info.json")
const ballotJSON = require("../artifacts/contracts/BallotGarageISEP.sol/BallotGarageISEP.json")
const generator = require("./generate_secrets_from_mails")
const fs = require("fs")
const mailer = require("./send_emails.js")
const data = fs.readFileSync('../mailsEtPonderation.csv', 'utf8')
const HDWalletProvider = require("@truffle/hdwallet-provider");

generator.generateSecrets(data)

async function main(){
    let provider = new HDWalletProvider(chainInfo.private_key, chainInfo.rinkeby)
    let web3 = new Web3(provider)
    let nowTimestamp = Math.floor(Date.now() / 1000)
    let candidateNames = []
    let voteDuration
    let voteSubject

    let accounts = await web3.eth.getAccounts()
    console.log(accounts)
    process.argv.forEach((val, index) => {
        if(index > 1){
            if(index === 2) {
                voteDuration = parseInt(val)
            } else if (index === 3) {
                voteSubject = val
            } else {
                candidateNames.push(val)
            }
        }
    })
    let candidatesArg = []
    candidateNames.forEach(name => candidatesArg.push(utils.strToBytes32(name,web3)))
    let ballot = await utils.deployContract(ballotJSON,chainInfo.address,web3,[nowTimestamp, nowTimestamp + voteDuration, candidatesArg])
    let userInfos = JSON.parse(fs.readFileSync("./users_mails_and_codes.json", 'utf8'))
    let codesThatVoted = []

    await mailer.sendMails(voteSubject,candidateNames,userInfos)

    app.get('/results', async (req, res) => {
        let scores = []
        let tempScore
        for (const name of candidateNames) {
            tempScore = await ballot.methods.getCandidateScore(utils.strToBytes32(name,web3)).call()
            tempScore = tempScore / (10 ** 18)
            scores.push({name: name, score: tempScore})
        }
        let returnedString = `<h1>Vote-dapp : ${voteSubject}</h1><br><br>scores actuels : <br>\n`
        scores.forEach(score => returnedString += score.name + " : " + score.score + "<br>\n")
        if (Math.floor(Date.now() / 1000) < nowTimestamp + voteDuration) {
            returnedString += "attention : les votes ne sont pas encore clos"
        } else {
            returnedString += "ces scores sont les résultats finaux."
        }
        res.send(returnedString)
    })

    app.get('/vote/:vote/:secret', async (req, res) => {
        let vote = req.params.vote, secret = req.params.secret
        let user = userInfos.find(user => user.code === secret)
        let receipt

        if (user === undefined){
            res.send('error : no user with this code found')
            return
        }
        if (codesThatVoted.some(code => code === user.code)){
            res.send('vous avez déjà voté, vous ne pouvez pas voter à nouveau.')
            return
        }
        codesThatVoted.push(user.code)
        try {
            receipt = await utils.sendContrFunc(ballot.methods.vote(utils.strToBytes32(vote,web3),parseInt(user.weightCode)),chainInfo.address)
            res.send('Vote envoyé à la blockchain. <br>\n hash de la transaction : ' + receipt.transactionHash)
        } catch (err) {
            res.send('error : ' + err)
        }
    })

    app.listen(port, () => {
        console.log(`app listening on port ${port}`)
    })
}

main()
