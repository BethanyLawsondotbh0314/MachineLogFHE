// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MachineLogFHE is SepoliaConfig {
    struct EncryptedLog {
        uint256 logId;
        euint32 encryptedTemperature;
        euint32 encryptedPressure;
        euint32 encryptedVibration;
        euint32 encryptedErrorCode;
        uint256 timestamp;
    }

    struct FaultAnalysis {
        euint32 encryptedSeverity;
        euint32 encryptedConfidence;
        bool isDetected;
        bool isRevealed;
    }

    struct DecryptedResult {
        uint32 severity;
        uint32 confidence;
        bool isRevealed;
    }

    mapping(address => bool) public authorizedTechnicians;
    mapping(uint256 => EncryptedLog) public machineLogs;
    mapping(uint256 => FaultAnalysis) public faultAnalyses;
    mapping(uint256 => DecryptedResult) public decryptedResults;
    
    uint256 public logCount;
    uint256 public analysisCount;
    address public admin;
    
    event TechnicianAdded(address indexed technician);
    event LogRecorded(uint256 indexed logId);
    event AnalysisPerformed(uint256 indexed analysisId);
    event FaultDetected(uint256 indexed analysisId);
    event ResultRevealed(uint256 indexed analysisId);

    constructor() {
        admin = msg.sender;
        authorizedTechnicians[admin] = true;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Admin only");
        _;
    }

    modifier onlyTechnician() {
        require(authorizedTechnicians[msg.sender], "Unauthorized technician");
        _;
    }

    function addTechnician(address technician) public onlyAdmin {
        authorizedTechnicians[technician] = true;
        emit TechnicianAdded(technician);
    }

    function recordEncryptedLog(
        euint32 temperature,
        euint32 pressure,
        euint32 vibration,
        euint32 errorCode
    ) public onlyTechnician {
        logCount++;
        machineLogs[logCount] = EncryptedLog({
            logId: logCount,
            encryptedTemperature: temperature,
            encryptedPressure: pressure,
            encryptedVibration: vibration,
            encryptedErrorCode: errorCode,
            timestamp: block.timestamp
        });
        emit LogRecorded(logCount);
    }

    function analyzeLog(uint256 logId) public onlyTechnician returns (uint256) {
        analysisCount++;
        uint256 analysisId = analysisCount;
        
        EncryptedLog storage log = machineLogs[logId];
        
        ebool tempHigh = FHE.gt(log.encryptedTemperature, FHE.asEuint32(100));
        ebool pressureHigh = FHE.gt(log.encryptedPressure, FHE.asEuint32(150));
        ebool vibrationHigh = FHE.gt(log.encryptedVibration, FHE.asEuint32(50));
        ebool hasError = FHE.gt(log.encryptedErrorCode, FHE.asEuint32(0));
        
        euint32 severity = FHE.asEuint32(0);
        severity = FHE.add(severity, FHE.select(tempHigh, FHE.asEuint32(1), FHE.asEuint32(0)));
        severity = FHE.add(severity, FHE.select(pressureHigh, FHE.asEuint32(1), FHE.asEuint32(0)));
        severity = FHE.add(severity, FHE.select(vibrationHigh, FHE.asEuint32(1), FHE.asEuint32(0)));
        severity = FHE.add(severity, FHE.select(hasError, FHE.asEuint32(2), FHE.asEuint32(0)));
        
        euint32 confidence = FHE.mul(
            severity,
            FHE.asEuint32(25)
        );
        
        ebool faultDetected = FHE.gt(severity, FHE.asEuint32(2));
        
        faultAnalyses[analysisId] = FaultAnalysis({
            encryptedSeverity: severity,
            encryptedConfidence: confidence,
            isDetected: false, // Will be set after decryption
            isRevealed: false
        });
        
        emit AnalysisPerformed(analysisId);
        
        if (FHE.isTrue(faultDetected)) {
            emit FaultDetected(analysisId);
        }
        
        return analysisId;
    }

    function requestAnalysisDecryption(uint256 analysisId) public onlyTechnician {
        require(!faultAnalyses[analysisId].isRevealed, "Already revealed");
        
        FaultAnalysis storage analysis = faultAnalyses[analysisId];
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(analysis.encryptedSeverity);
        ciphertexts[1] = FHE.toBytes32(analysis.encryptedConfidence);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAnalysis.selector);
    }

    function decryptAnalysis(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public onlyTechnician {
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        uint256 latestAnalysisId = analysisCount;
        
        decryptedResults[latestAnalysisId] = DecryptedResult({
            severity: results[0],
            confidence: results[1],
            isRevealed: true
        });
        
        faultAnalyses[latestAnalysisId].isDetected = results[0] > 2;
        faultAnalyses[latestAnalysisId].isRevealed = true;
        emit ResultRevealed(latestAnalysisId);
    }

    function predictMaintenance(
        uint256[] memory logIds
    ) public view onlyTechnician returns (ebool) {
        euint32 totalSeverity = FHE.asEuint32(0);
        
        for (uint256 i = 0; i < logIds.length; i++) {
            uint256 logId = logIds[i];
            totalSeverity = FHE.add(
                totalSeverity,
                faultAnalyses[logId].encryptedSeverity
            );
        }
        
        euint32 avgSeverity = FHE.div(
            totalSeverity,
            FHE.asEuint32(uint32(logIds.length))
        );
        
        return FHE.gt(avgSeverity, FHE.asEuint32(1));
    }

    function getLogCount() public view returns (uint256) {
        return logCount;
    }

    function getAnalysisCount() public view returns (uint256) {
        return analysisCount;
    }

    function getDecryptedResult(uint256 analysisId) public view returns (
        uint32 severity,
        uint32 confidence,
        bool isRevealed
    ) {
        DecryptedResult storage result = decryptedResults[analysisId];
        return (result.severity, result.confidence, result.isRevealed);
    }
}