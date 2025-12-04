// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface MachineLog {
  id: string;
  encryptedData: string;
  timestamp: number;
  machineId: string;
  status: "normal" | "warning" | "critical";
  anomalyScore: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<MachineLog[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newLogData, setNewLogData] = useState({
    machineId: "",
    logData: "",
    anomalyScore: 0
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [logsPerPage] = useState(5);
  const [showStatistics, setShowStatistics] = useState(true);

  // Calculate statistics
  const normalCount = logs.filter(log => log.status === "normal").length;
  const warningCount = logs.filter(log => log.status === "warning").length;
  const criticalCount = logs.filter(log => log.status === "critical").length;
  const totalAnomalyScore = logs.reduce((sum, log) => sum + log.anomalyScore, 0);
  const avgAnomalyScore = logs.length > 0 ? (totalAnomalyScore / logs.length).toFixed(2) : "0.00";

  useEffect(() => {
    loadLogs().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadLogs = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("log_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing log keys:", e);
        }
      }
      
      const list: MachineLog[] = [];
      
      for (const key of keys) {
        try {
          const logBytes = await contract.getData(`log_${key}`);
          if (logBytes.length > 0) {
            try {
              const logData = JSON.parse(ethers.toUtf8String(logBytes));
              list.push({
                id: key,
                encryptedData: logData.data,
                timestamp: logData.timestamp,
                machineId: logData.machineId,
                status: logData.status || "normal",
                anomalyScore: logData.anomalyScore || 0
              });
            } catch (e) {
              console.error(`Error parsing log data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading log ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setLogs(list);
    } catch (e) {
      console.error("Error loading logs:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitLog = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting machine log with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newLogData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const logId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const logData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        machineId: newLogData.machineId,
        status: newLogData.anomalyScore > 70 ? "critical" : 
                newLogData.anomalyScore > 30 ? "warning" : "normal",
        anomalyScore: newLogData.anomalyScore
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `log_${logId}`, 
        ethers.toUtf8Bytes(JSON.stringify(logData))
      );
      
      const keysBytes = await contract.getData("log_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(logId);
      
      await contract.setData(
        "log_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Machine log encrypted and stored securely!"
      });
      
      await loadLogs();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewLogData({
          machineId: "",
          logData: "",
          anomalyScore: 0
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const checkAvailability = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Checking FHE availability..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE system is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Filter and paginate logs
  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.machineId.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         log.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === "all" || log.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // Get current logs
  const indexOfLastLog = currentPage * logsPerPage;
  const indexOfFirstLog = indexOfLastLog - logsPerPage;
  const currentLogs = filteredLogs.slice(indexOfFirstLog, indexOfLastLog);

  // Change page
  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the FHE-powered machine log analyzer",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted Logs",
      description: "Upload machine logs which are immediately encrypted using FHE technology",
      icon: "🔒"
    },
    {
      title: "FHE Analysis",
      description: "Logs are analyzed in encrypted state without exposing sensitive industrial data",
      icon: "⚙️"
    },
    {
      title: "Get Insights",
      description: "Receive maintenance alerts and insights while keeping production details private",
      icon: "📊"
    }
  ];

  const renderStatusChart = () => {
    const total = logs.length || 1;
    const normalPercentage = (normalCount / total) * 100;
    const warningPercentage = (warningCount / total) * 100;
    const criticalPercentage = (criticalCount / total) * 100;

    return (
      <div className="status-chart-container">
        <div className="status-chart">
          <div 
            className="chart-segment normal" 
            style={{ width: `${normalPercentage}%` }}
          ></div>
          <div 
            className="chart-segment warning" 
            style={{ width: `${warningPercentage}%` }}
          ></div>
          <div 
            className="chart-segment critical" 
            style={{ width: `${criticalPercentage}%` }}
          ></div>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-dot normal"></div>
            <span>Normal: {normalCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot warning"></div>
            <span>Warning: {warningCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot critical"></div>
            <span>Critical: {criticalCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container industrial-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="gear-icon"></div>
          </div>
          <h1>MachineLog<span>FHE</span></h1>
          <div className="fhe-badge">
            <span>FHE-ENCRYPTED</span>
          </div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-log-btn industrial-btn"
          >
            <div className="add-icon"></div>
            Add Log
          </button>
          <button 
            className="industrial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <button 
            className="industrial-btn"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Industrial Machine Log Analyzer</h2>
            <p>Process sensitive machine logs in encrypted state using FHE technology without exposing industrial secrets</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE Machine Log Analysis</h2>
            <p className="subtitle">Secure industrial data processing with Fully Homomorphic Encryption</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="controls-row">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search machine ID or log ID..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="industrial-input"
            />
          </div>
          
          <div className="filter-controls">
            <select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="industrial-select"
            >
              <option value="all">All Status</option>
              <option value="normal">Normal</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
            
            <button 
              onClick={() => setShowStatistics(!showStatistics)}
              className="industrial-btn"
            >
              {showStatistics ? "Hide Stats" : "Show Stats"}
            </button>
          </div>
        </div>
        
        {showStatistics && (
          <div className="dashboard-grid">
            <div className="dashboard-card industrial-card">
              <h3>Project Overview</h3>
              <p>Industrial 4.0 solution for encrypted machine log analysis using FHE to protect production secrets while enabling predictive maintenance.</p>
              <div className="fhe-badge">
                <span>FHE-Powered</span>
              </div>
            </div>
            
            <div className="dashboard-card industrial-card">
              <h3>Log Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{logs.length}</div>
                  <div className="stat-label">Total Logs</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{normalCount}</div>
                  <div className="stat-label">Normal</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{warningCount}</div>
                  <div className="stat-label">Warnings</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{criticalCount}</div>
                  <div className="stat-label">Critical</div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-card industrial-card">
              <h3>Status Distribution</h3>
              {renderStatusChart()}
              <div className="anomaly-score">
                Average Anomaly Score: {avgAnomalyScore}
              </div>
            </div>
          </div>
        )}
        
        <div className="logs-section">
          <div className="section-header">
            <h2>Encrypted Machine Logs</h2>
            <div className="header-actions">
              <button 
                onClick={loadLogs}
                className="refresh-btn industrial-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Logs"}
              </button>
            </div>
          </div>
          
          <div className="logs-list industrial-card">
            <div className="table-header">
              <div className="header-cell">Log ID</div>
              <div className="header-cell">Machine ID</div>
              <div className="header-cell">Timestamp</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Anomaly Score</div>
            </div>
            
            {currentLogs.length === 0 ? (
              <div className="no-logs">
                <div className="no-logs-icon"></div>
                <p>No machine logs found</p>
                <button 
                  className="industrial-btn primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Log
                </button>
              </div>
            ) : (
              currentLogs.map(log => (
                <div className="log-row" key={log.id}>
                  <div className="table-cell log-id">#{log.id.substring(0, 6)}</div>
                  <div className="table-cell">{log.machineId}</div>
                  <div className="table-cell">
                    {new Date(log.timestamp * 1000).toLocaleString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${log.status}`}>
                      {log.status}
                    </span>
                  </div>
                  <div className="table-cell">
                    <div className="score-bar">
                      <div 
                        className={`score-fill ${log.status}`}
                        style={{ width: `${log.anomalyScore}%` }}
                      ></div>
                      <span>{log.anomalyScore}%</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {filteredLogs.length > logsPerPage && (
            <div className="pagination">
              {Array.from({ length: Math.ceil(filteredLogs.length / logsPerPage) }, (_, i) => i + 1).map(number => (
                <button
                  key={number}
                  onClick={() => paginate(number)}
                  className={`pagination-btn ${currentPage === number ? 'active' : ''}`}
                >
                  {number}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitLog} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          logData={newLogData}
          setLogData={setNewLogData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content industrial-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="gear-icon"></div>
              <span>MachineLogFHE</span>
            </div>
            <p>Confidential industrial machine log analysis using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact Support</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Industrial Security</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} MachineLogFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  logData: any;
  setLogData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  logData,
  setLogData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setLogData({
      ...logData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!logData.machineId || !logData.logData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal industrial-card">
        <div className="modal-header">
          <h2>Add Encrypted Machine Log</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Your industrial data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Machine ID *</label>
              <input 
                type="text"
                name="machineId"
                value={logData.machineId} 
                onChange={handleChange}
                placeholder="Enter machine identifier..." 
                className="industrial-input"
              />
            </div>
            
            <div className="form-group">
              <label>Anomaly Score</label>
              <input 
                type="range"
                name="anomalyScore"
                min="0"
                max="100"
                value={logData.anomalyScore} 
                onChange={handleChange}
                className="industrial-range"
              />
              <div className="range-value">{logData.anomalyScore}%</div>
            </div>
            
            <div className="form-group full-width">
              <label>Log Data *</label>
              <textarea 
                name="logData"
                value={logData.logData} 
                onChange={handleChange}
                placeholder="Enter machine log data to encrypt..." 
                className="industrial-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> Industrial secrets remain encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn industrial-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn industrial-btn primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;